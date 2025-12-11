"""
Utility to download and execute Airtest scripts.
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, Optional

import requests

logger = logging.getLogger("airtest-runner")


class AirtestRunner:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace
        self.workspace.mkdir(parents=True, exist_ok=True)

    def download_script(self, url: str, filename: str) -> Path:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        dest = self.workspace / filename
        dest.write_bytes(resp.content)
        return dest

    def run(self, script_path: Path, device_serial: Optional[str], task_id: str) -> Dict[str, str]:
        log_dir = self.workspace / f"task_{task_id}"
        log_dir.mkdir(parents=True, exist_ok=True)
        cmd = ["airtest", "run", str(script_path), "--log", str(log_dir)]
        if device_serial:
            cmd.extend(["--device", f"adb://{device_serial}"])
        logger.info("Running Airtest: %s", " ".join(cmd))
        proc = subprocess.run(cmd, capture_output=True, text=True)
        output_file = log_dir / "stdout.log"
        output_file.write_text(proc.stdout + "\n" + proc.stderr, encoding="utf-8")
        status = "succeeded" if proc.returncode == 0 else "failed"
        return {"status": status, "log_dir": str(log_dir), "stdout": str(output_file)}
