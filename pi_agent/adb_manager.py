"""
Thin wrappers around adb for input commands and device detection.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from typing import List, Optional

ADB_BIN = os.getenv("ADB_BIN", "adb")
logger = logging.getLogger("adb")


def _run(args: List[str], serial: Optional[str] = None, check: bool = True) -> str:
    cmd = [ADB_BIN]
    if serial:
        cmd.extend(["-s", serial])
    cmd.extend(args)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise RuntimeError(f"adb failed: {' '.join(cmd)}\n{proc.stderr}")
    return proc.stdout.strip()


def list_devices() -> List[str]:
    out = _run(["devices"], check=False)
    devices = []
    for line in out.splitlines()[1:]:
        if not line.strip():
            continue
        serial, status = re.split(r"\s+", line.strip())[:2]
        if status == "device":
            devices.append(serial)
    return devices


def ensure_device(serial: Optional[str] = None, wifi_fallback: Optional[str] = None) -> Optional[str]:
    """
    Ensure we have at least one connected device. If serial is provided, verify it.
    wifi_fallback may point to host:port for adb connect.
    """
    try:
        _run(["start-server"], check=False)
    except Exception:
        logger.exception("Failed to start adb server")
    devices = list_devices()
    if serial and serial in devices:
        return serial
    if devices:
        return devices[0]
    if wifi_fallback:
        _run(["connect", wifi_fallback], check=False)
        devices = list_devices()
        if devices:
            return devices[0]
    return None


def input_tap(x: int, y: int, serial: Optional[str]) -> None:
    _run(["shell", "input", "tap", str(x), str(y)], serial=serial)


def input_swipe(x1: int, y1: int, x2: int, y2: int, duration_ms: int, serial: Optional[str]) -> None:
    _run(["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration_ms)], serial=serial)


def input_text(text: str, serial: Optional[str]) -> None:
    _run(["shell", "input", "text", text], serial=serial)


def input_keyevent(key: str, serial: Optional[str]) -> None:
    _run(["shell", "input", "keyevent", key], serial=serial)
