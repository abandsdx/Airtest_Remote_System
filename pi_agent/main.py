"""
Entry point for the Pi Agent.
"""

from __future__ import annotations

import asyncio
import logging

from .config import AgentConfig
from .device_detector import DeviceDetector
from .websocket_client import AgentClient


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = AgentConfig.from_env()
    agent = AgentClient(config)

    detector = DeviceDetector(on_change=lambda devices: logging.info("Devices: %s", devices))
    await detector.start()
    await agent.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
