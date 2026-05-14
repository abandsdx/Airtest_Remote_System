"""
Periodic device detection so the agent can keep track of attached Android devices.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable, Optional

from . import adb_manager

logger = logging.getLogger("device-detector")


class DeviceDetector:
    def __init__(self, interval: float = 5.0, on_change: Optional[Callable[[list[str]], None]] = None) -> None:
        self.interval = interval
        self.on_change = on_change
        self._last = set()
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _run(self) -> None:
        while True:
            try:
                devices = set(adb_manager.list_devices())
                if devices != self._last:
                    logger.info("ADB devices changed: %s", devices)
                    self._last = devices
                    if self.on_change:
                        self.on_change(sorted(devices))
            except Exception:
                logger.exception("Device detection failed")
            await asyncio.sleep(self.interval)
