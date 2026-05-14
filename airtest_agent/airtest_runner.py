"""
Utility to download and execute Airtest scripts.
"""

from __future__ import annotations

import asyncio
from collections import deque
import logging
import os
import subprocess
import shutil
import zipfile
from pathlib import Path
from typing import Awaitable, Callable, Dict, Optional

import requests

logger = logging.getLogger("airtest-runner")


def build_airtest_device_uri(device_serial: Optional[str]) -> Optional[str]:
    if not device_serial:
        return None
    serial = device_serial.strip()
    if "://" in serial:
        return serial
    return f"Android://127.0.0.1:5037/{serial}"


def _split_pythonpath(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return [item for item in value.split(os.pathsep) if item]


def build_pythonpath(
    script_path: Path,
    existing: Optional[str] = None,
    extra_paths: Optional[str] = None,
) -> str:
    candidates = [script_path, script_path.parent, *[Path(item).expanduser() for item in _split_pythonpath(extra_paths)]]
    seen = set()
    paths = []
    for candidate in candidates:
        resolved = str(candidate.resolve())
        if resolved not in seen:
            seen.add(resolved)
            paths.append(resolved)
    if existing:
        paths.append(existing)
    return os.pathsep.join(paths)


class AirtestRunner:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace
        self.workspace.mkdir(parents=True, exist_ok=True)

    def download_script(self, url: str, filename: str, headers: Optional[Dict[str, str]] = None) -> Path:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        safe_name = Path(filename).name
        dest = self.workspace / safe_name
        dest.write_bytes(resp.content)

        if safe_name.endswith(".air"):
            raise ValueError(
                "Downloaded .air is a file, but Airtest .air projects must be directories. "
                "Use Upload Folder for the .air directory, or upload a .zip containing the .air directory."
            )

        if safe_name.endswith(".zip"):
            extract_dir = self.workspace / safe_name[:-4]
            if extract_dir.exists():
                shutil.rmtree(extract_dir)
            extract_dir.mkdir(parents=True)
            with zipfile.ZipFile(dest, "r") as zip_ref:
                self._extract_zip_safely(zip_ref, extract_dir)

            air_dirs = sorted(path for path in extract_dir.rglob("*.air") if path.is_dir())
            if len(air_dirs) == 1:
                return air_dirs[0]
            if len(air_dirs) > 1:
                zip_stem = Path(safe_name[:-4]).name
                matching_dirs = [
                    path for path in air_dirs
                    if path.name == zip_stem or path.name == f"{zip_stem}.air"
                ]
                if len(matching_dirs) == 1:
                    return matching_dirs[0]
                names = ", ".join(str(path.relative_to(extract_dir)) for path in air_dirs[:10])
                raise ValueError(
                    "Multiple .air projects found in uploaded zip. "
                    "Upload a package folder that contains only the target .air project and its shared dependencies. "
                    f"Found: {names}"
                )
            # Fallback if no .air directory is explicitly found
            return extract_dir

        return dest

    def _extract_zip_safely(self, zip_ref: zipfile.ZipFile, extract_dir: Path) -> None:
        root = extract_dir.resolve()
        for member in zip_ref.infolist():
            target = (extract_dir / member.filename).resolve()
            try:
                target.relative_to(root)
            except ValueError:
                raise ValueError(f"Unsafe zip entry: {member.filename}")
            zip_ref.extract(member, extract_dir)

    async def _terminate_process(self, proc: asyncio.subprocess.Process, label: str) -> None:
        if proc.returncode is not None:
            return
        logger.info("Stopping %s process...", label)
        try:
            proc.terminate()
        except ProcessLookupError:
            return

        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            logger.warning("%s process did not stop cleanly; killing it.", label)
            proc.kill()
            await proc.wait()

    async def run(
        self,
        script_path: Path,
        device_serial: Optional[str],
        task_id: str,
        variables: Optional[Dict[str, str]] = None,
        log_callback: Optional[Callable[[str], Awaitable[None]]] = None,
    ) -> Dict[str, str]:
        log_dir = self.workspace / f"task_{task_id}"
        log_dir.mkdir(parents=True, exist_ok=True)
        output_file = log_dir / "stdout.log"
        log_tail = deque(maxlen=20)
        cmd = ["airtest", "run", str(script_path), "--log", str(log_dir)]
        device_uri = build_airtest_device_uri(device_serial)
        if device_uri:
            cmd.extend(["--device", device_uri])
        logger.info("Running Airtest: %s", " ".join(cmd))

        env = os.environ.copy()
        env["PYTHONPATH"] = build_pythonpath(
            script_path,
            existing=env.get("PYTHONPATH"),
            extra_paths=env.get("AIRTEST_EXTRA_PYTHONPATH"),
        )
        if variables:
            for k, v in variables.items():
                env[str(k)] = str(v)

        proc = None
        stopped = False
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
            )

            with output_file.open("w", encoding="utf-8") as f_out:
                while True:
                    assert proc.stdout is not None
                    line = await proc.stdout.readline()
                    if not line:
                        break
                    line_str = line.decode("utf-8", errors="replace")
                    f_out.write(line_str)
                    f_out.flush()
                    log_tail.append(line_str.rstrip())
                    if log_callback is not None:
                        asyncio.create_task(log_callback(line_str.strip()))

            await proc.wait()
        except asyncio.CancelledError:
            stopped = True
            if proc is not None:
                await self._terminate_process(proc, "Airtest")
            stop_message = "[System] Task stopped by user."
            with output_file.open("a", encoding="utf-8") as f_out:
                f_out.write(f"\n{stop_message}\n")
            log_tail.append(stop_message)
            if log_callback is not None:
                await log_callback(stop_message)

        # Generate HTML report
        if not stopped:
            report_cmd = ["airtest", "report", str(script_path), "--log_root", str(log_dir), "--outfile", str(log_dir / "log.html")]
            logger.info("Generating Airtest report: %s", " ".join(report_cmd))
            report_proc = None
            try:
                report_proc = await asyncio.create_subprocess_exec(
                    *report_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                )
                await report_proc.wait()
            except asyncio.CancelledError:
                stopped = True
                if report_proc is not None:
                    await self._terminate_process(report_proc, "Airtest report")
                stop_message = "[System] Task stopped while generating report."
                with output_file.open("a", encoding="utf-8") as f_out:
                    f_out.write(f"\n{stop_message}\n")
                log_tail.append(stop_message)
                if log_callback is not None:
                    await log_callback(stop_message)

        # Zip the entire log directory
        report_base = self.workspace / f"report_{task_id}"
        report_zip = Path(shutil.make_archive(str(report_base), "zip", str(log_dir)))

        status = "stopped" if stopped else "succeeded" if proc and proc.returncode == 0 else "failed"
        return {
            "status": status,
            "log_dir": str(log_dir),
            "stdout_path": str(output_file),
            "stdout_tail": "\n".join(line for line in log_tail if line).strip(),
            "report_zip": str(report_zip),
        }
