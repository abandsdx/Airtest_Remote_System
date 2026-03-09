"""
Configuration helpers for the Pi Agent.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from pathlib import Path


@dataclass
class AgentConfig:
    server_host: str
    agent_id: str
    device_shared_key: str
    adb_serial: str | None
    data_dir: Path
    stun_servers: list[str]

    @classmethod
    def from_env(cls) -> "AgentConfig":
        server_host = os.getenv("CLOUD_SERVER", "ws://localhost:8081")
        agent_id = os.getenv("AGENT_ID", uuid.uuid4().hex[:8])
        device_shared_key = os.getenv("DEVICE_SHARED_KEY", "rider-dev-key")
        adb_serial = os.getenv("ADB_SERIAL")
        data_dir = Path(os.getenv("AGENT_DATA", "/tmp/airtest_agent")).expanduser()
        stun_env = os.getenv("STUN_SERVERS", "stun:stun.l.google.com:19302")
        stun_servers = [s.strip() for s in stun_env.split(",") if s.strip()]
        data_dir.mkdir(parents=True, exist_ok=True)
        return cls(
            server_host=server_host,
            agent_id=agent_id,
            device_shared_key=device_shared_key,
            adb_serial=adb_serial,
            data_dir=data_dir,
            stun_servers=stun_servers,
        )
