"""
Minimal WebRTC streamer that can respond to browser offers and expose a control
DataChannel. The video track is a placeholder; replace with scrcpy/ffmpeg
pipeline for real device streaming.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Optional

import numpy as np
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import VideoStreamTrack
from aiortc.rtcicetransport import RTCIceCandidate, RTCIceServer
from av import VideoFrame

logger = logging.getLogger("webrtc")


class DummyVideoStreamTrack(VideoStreamTrack):
    """
    Sends a blank frame so that the WebRTC pipeline remains alive even if
    scrcpy is not wired up yet.
    """

    kind = "video"

    def __init__(self, width: int = 640, height: int = 360) -> None:
        super().__init__()
        self.width = width
        self.height = height

    async def recv(self) -> VideoFrame:
        pts, time_base = await self.next_timestamp()
        frame = VideoFrame.from_ndarray(
            np.zeros((self.height, self.width, 3), dtype=np.uint8), format="bgr24"
        )
        frame.pts = pts
        frame.time_base = time_base
        return frame


class WebRTCStreamer:
    def __init__(
        self,
        stun_servers: list[str],
        send_signaling: Callable[[dict], asyncio.Future],
        on_control: Callable[[dict], None],
    ) -> None:
        self.stun_servers = stun_servers
        self.send_signaling = send_signaling
        self.on_control = on_control
        self.pc: Optional[RTCPeerConnection] = None
        self.control_channel = None
        self._placeholder_video = DummyVideoStreamTrack()

    async def _init_peer(self) -> None:
        if self.pc:
            await self.pc.close()
        ice_servers = [RTCIceServer(urls=self.stun_servers)]
        self.pc = RTCPeerConnection(configuration=RTCConfiguration(iceServers=ice_servers))
        self.pc.addTrack(self._placeholder_video)

        @self.pc.on("datachannel")
        def on_datachannel(channel):
            self.control_channel = channel

            @channel.on("message")
            def on_message(message: Any) -> None:
                try:
                    payload = json.loads(message)
                    self.on_control(payload)
                except Exception:
                    logger.exception("Invalid control message: %s", message)

        @self.pc.on("icecandidate")
        async def on_icecandidate(candidate: Optional[RTCIceCandidate]) -> None:
            if candidate is None:
                return
            await self.send_signaling(
                {
                    "type": "candidate",
                    "candidate": candidate.to_sdp(),
                    "sdpMid": candidate.sdpMid,
                    "sdpMLineIndex": candidate.sdpMLineIndex,
                }
            )

        @self.pc.on("connectionstatechange")
        def on_state_change() -> None:
            logger.info("WebRTC connection state: %s", self.pc.connectionState)

    async def handle_signaling(self, payload: dict) -> None:
        msg_type = payload.get("type")
        if msg_type == "offer":
            await self._init_peer()
            offer = RTCSessionDescription(sdp=payload["sdp"], type="offer")
            await self.pc.setRemoteDescription(offer)
            answer = await self.pc.createAnswer()
            await self.pc.setLocalDescription(answer)
            await self.send_signaling({"type": "answer", "sdp": self.pc.localDescription.sdp})
        elif msg_type == "candidate" and self.pc:
            candidate = RTCIceCandidate(
                sdpMid=payload.get("sdpMid"),
                sdpMLineIndex=payload.get("sdpMLineIndex"),
                candidate=payload.get("candidate"),
            )
            await self.pc.addIceCandidate(candidate)
        else:
            logger.warning("Unhandled signaling payload: %s", payload)

    async def close(self) -> None:
        if self.pc:
            await self.pc.close()
            self.pc = None
