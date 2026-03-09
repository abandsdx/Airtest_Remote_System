"""
WebSocket client that keeps a persistent link with the Cloud Server, handles
task execution, and proxies WebRTC signaling/control messages.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urljoin

import requests
import websockets

from . import adb_manager
from .airtest_runner import AirtestRunner
from .config import AgentConfig
from .webrtc_streamer import WebRTCStreamer

logger = logging.getLogger("agent")


def _ws_to_http(ws_url: str) -> str:
    if ws_url.startswith("wss://"):
        return "https://" + ws_url[len("wss://") :]
    if ws_url.startswith("ws://"):
        return "http://" + ws_url[len("ws://") :]
    return ws_url


class AgentClient:
    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.airtest_runner = AirtestRunner(config.data_dir / "scripts")
        self.device_serial: Optional[str] = None
        self.webrtc = WebRTCStreamer(
            stun_servers=config.stun_servers, send_signaling=self._send_signaling, on_control=self.handle_control
        )
        self._heartbeat_task: Optional[asyncio.Task] = None

    def _device_headers(self) -> Dict[str, str]:
        return {"X-Device-Key": self.config.device_shared_key}

    async def _send_signaling(self, payload: dict) -> None:
        await self.send({"type": "signaling", "payload": payload})

    async def _send_log(self, text: str) -> None:
        await self.send({"type": "log", "message": text})

    async def send(self, payload: Dict[str, Any]) -> None:
        if not self.ws:
            return
        await self.ws.send(json.dumps(payload))

    async def handle_control(self, payload: Dict[str, Any]) -> None:
        command = payload.get("command")
        args = payload.get("args") or payload
        target = self.device_serial
        try:
            if command == "tap":
                adb_manager.input_tap(int(args["x"]), int(args["y"]), target)
            elif command == "swipe":
                adb_manager.input_swipe(
                    int(args["x1"]),
                    int(args["y1"]),
                    int(args["x2"]),
                    int(args["y2"]),
                    int(args.get("duration", 300)),
                    target,
                )
            elif command == "text":
                adb_manager.input_text(str(args.get("text", "")), target)
            elif command == "key":
                adb_manager.input_keyevent(str(args.get("key", "")), target)
        except Exception:
            logger.exception("Failed to apply control command: %s", payload)

    async def handle_run_task(self, message: Dict[str, Any]) -> None:
        task_id = message["task_id"]
        script_url = message["script_url"]
        script_name = message.get("script_name", "script.air")
        variables = message.get("vars", message.get("variables", {}))
        base_http = _ws_to_http(self.config.server_host)
        full_script_url = script_url if script_url.startswith("http") else urljoin(base_http, script_url)

        self.device_serial = adb_manager.ensure_device(serial=self.config.adb_serial, wifi_fallback=os.getenv("ADB_WIFI"))
        if not self.device_serial:
            await self.send(
                {"type": "task_result", "task_id": task_id, "status": "failed", "message": "No device connected"}
            )
            return
        try:
            script_path = await asyncio.to_thread(
                self.airtest_runner.download_script,
                full_script_url,
                script_name,
                self._device_headers(),
            )
            result = await self.airtest_runner.run(script_path, self.device_serial, task_id, variables=variables, log_callback=self._send_log)
            status = result["status"]
            message_text = result.get("stdout_tail", "")
            await self.send(
                {
                    "type": "task_result",
                    "task_id": task_id,
                    "status": status,
                    "message": message_text,
                    "artifacts": {"log_dir": result.get("log_dir", "")},
                }
            )
            await asyncio.to_thread(
                self._upload_artifacts,
                task_id,
                status,
                message_text,
                Path(result["stdout_path"]),
                result.get("report_zip"),
            )
        except Exception as exc:
            logger.exception("Task failed")
            await self.send({"type": "task_result", "task_id": task_id, "status": "failed", "message": str(exc)})

    def _upload_artifacts(self, task_id: str, status: str, message: str, log_path: Path, report_path: Optional[str] = None) -> None:
        base_http = _ws_to_http(self.config.server_host)
        url = urljoin(base_http, f"/api/tasks/{task_id}/result")
        files = {}
        if log_path.exists():
            files["log_file"] = open(log_path, "rb")
        if report_path and Path(report_path).exists():
            files["report_file"] = open(report_path, "rb")
        
        try:
            response = requests.post(
                url,
                data={"status": status, "message": message},
                files=files,
                headers=self._device_headers(),
                timeout=60,
            )
            response.raise_for_status()
        finally:
            for f in files.values():
                f.close()

    async def handle_message(self, message: Dict[str, Any]) -> None:
        msg_type = message.get("type")
        if msg_type == "run_task":
            await self.handle_run_task(message)
        elif msg_type == "signaling":
            await self.webrtc.handle_signaling(message["payload"])
        elif msg_type == "control":
            await self.handle_control(message)
        else:
            logger.debug("Unhandled message: %s", message)

    async def _heartbeat(self) -> None:
        while True:
            await asyncio.sleep(5)
            await self.send({
                "type": "status",
                "streaming": False,
                "camera": False,
                "mic": False
            })

    async def run(self) -> None:
        while True:
            try:
                # Service Rider specific path
                ws_url = f"{self.config.server_host}/ws/device"
                logger.info("Connecting to %s", ws_url)
                async with websockets.connect(ws_url) as ws:
                    self.ws = ws
                    # Service Rider auth format for device
                    await ws.send(json.dumps({
                        "type": "hello", 
                        "token": self.config.device_shared_key,
                        "deviceId": self.config.agent_id,
                        "info": {
                            "name": f"Pi Agent {self.config.agent_id}",
                            "model": "Raspberry Pi",
                            "manufacturer": "Raspberry Pi Foundation",
                            "osVersion": "Linux",
                            "appVersion": "1.0.0"
                        }
                    }))
                    self._heartbeat_task = asyncio.create_task(self._heartbeat())
                    while True:
                        raw = await ws.recv()
                        try:
                            message = json.loads(raw)
                            # Handle Service Rider welcome message
                            if message.get("type") == "welcome":
                                logger.info("Successfully connected and authenticated with Service Rider")
                                continue
                            
                            await self.handle_message(message)
                        except json.JSONDecodeError:
                            logger.warning("Invalid message: %s", raw)
            except Exception:
                logger.exception("Connection lost, retrying...")
                await asyncio.sleep(3)
            finally:
                if self._heartbeat_task:
                    self._heartbeat_task.cancel()
                    self._heartbeat_task = None
                await self.webrtc.close()
                self.ws = None
