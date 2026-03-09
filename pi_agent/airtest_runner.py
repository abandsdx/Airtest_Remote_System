"""
Utility to download and execute Airtest scripts.
"""

from __future__ import annotations

import asyncio
from collections import deque
import logging
import subprocess
import shutil
import zipfile
from pathlib import Path
from typing import Awaitable, Callable, Dict, Optional

import requests

logger = logging.getLogger("airtest-runner")


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

        if safe_name.endswith(".zip"):
            extract_dir = self.workspace / safe_name[:-4]
            if extract_dir.exists():
                shutil.rmtree(extract_dir)
            extract_dir.mkdir(parents=True)
            with zipfile.ZipFile(dest, "r") as zip_ref:
                self._extract_zip_safely(zip_ref, extract_dir)

            # Find the .air directory inside the extracted contents
            for path in extract_dir.rglob("*.air"):
                if path.is_dir():
                    return path
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

    async def run(
        self,
        script_path: Path,
        device_serial: Optional[str],
        task_id: str,
        variables: Optional[Dict[str, str]] = None,
        log_callback: Optional[Callable[[str], Awaitable[None]]] = None,
    ) -> Dict[str, str]:
        import os

        log_dir = self.workspace / f"task_{task_id}"
        log_dir.mkdir(parents=True, exist_ok=True)
        cmd = ["airtest", "run", str(script_path), "--log", str(log_dir)]
        if device_serial:
            cmd.extend(["--device", f"adb://{device_serial}"])
        logger.info("Running Airtest: %s", " ".join(cmd))

        env = os.environ.copy()
        if variables:
            for k, v in variables.items():
                env[str(k)] = str(v)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
        )

        output_file = log_dir / "stdout.log"
        log_tail = deque(maxlen=20)
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

        # Generate HTML report
        report_cmd = ["airtest", "report", str(script_path), "--log_root", str(log_dir), "--outfile", str(log_dir / "log.html")]
        logger.info("Generating Airtest report: %s", " ".join(report_cmd))
        report_proc = await asyncio.create_subprocess_exec(
            *report_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        await report_proc.wait()

        # Zip the entire log directory
        report_base = self.workspace / f"report_{task_id}"
        report_zip = Path(shutil.make_archive(str(report_base), "zip", str(log_dir)))

        status = "succeeded" if proc.returncode == 0 else "failed"
        return {
            "status": status,
            "log_dir": str(log_dir),
            "stdout_path": str(output_file),
            "stdout_tail": "\n".join(line for line in log_tail if line).strip(),
            "report_zip": str(report_zip),
        }
