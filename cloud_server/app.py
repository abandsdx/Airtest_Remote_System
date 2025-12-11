"""
Cloud Server for the Airtest Remote Control System.

- FastAPI REST endpoints for agent/task management and artifact upload.
- WebSocket signaling channels for agents and web UI clients.
- In-memory task queues per agent with simple persistence for uploaded scripts.

Run locally:
    uvicorn cloud_server.app:app --host 0.0.0.0 --port 8081 --reload
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiofiles
from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Form,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("airtest-cloud")

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
SCRIPTS_DIR = STORAGE_DIR / "scripts"
RESULTS_DIR = STORAGE_DIR / "results"
WEB_DIST = BASE_DIR.parent / "web_ui" / "dist"


def _now() -> float:
    return time.time()


class ScriptMeta(BaseModel):
    id: str
    filename: str
    stored_name: str
    created_at: float


class TaskStatus(str):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class TaskRecord(BaseModel):
    id: str
    agent_id: str
    script_id: str
    variables: Dict[str, Any] = Field(default_factory=dict)
    status: str = TaskStatus.QUEUED
    message: str = ""
    created_at: float = Field(default_factory=_now)
    updated_at: float = Field(default_factory=_now)
    artifacts: Dict[str, str] = Field(default_factory=dict)


class AgentInfo(BaseModel):
    id: str
    online: bool
    last_seen: float
    meta: Dict[str, Any] = Field(default_factory=dict)
    current_task: Optional[str] = None
    queue_size: int = 0


class CreateTaskRequest(BaseModel):
    script_id: str
    variables: Dict[str, Any] = Field(default_factory=dict)


class ScriptStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.index_path = self.root / "index.json"
        self._scripts: Dict[str, ScriptMeta] = {}
        self._load()

    def _load(self) -> None:
        if self.index_path.exists():
            try:
                raw = json.loads(self.index_path.read_text(encoding="utf-8"))
                for item in raw:
                    meta = ScriptMeta(**item)
                    self._scripts[meta.id] = meta
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Failed to load script index: %s", exc)

    def _save(self) -> None:
        payload = [meta.model_dump() for meta in self._scripts.values()]
        self.index_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    async def add(self, upload: UploadFile) -> ScriptMeta:
        script_id = uuid.uuid4().hex
        stored_name = f"{script_id}_{upload.filename}"
        dest = self.root / stored_name
        async with aiofiles.open(dest, "wb") as f:
            while chunk := await upload.read(1024 * 1024):
                await f.write(chunk)
        meta = ScriptMeta(
            id=script_id,
            filename=upload.filename,
            stored_name=stored_name,
            created_at=_now(),
        )
        self._scripts[script_id] = meta
        self._save()
        logger.info("Stored script %s -> %s", upload.filename, dest)
        return meta

    def list(self) -> List[ScriptMeta]:
        return sorted(self._scripts.values(), key=lambda m: m.created_at, reverse=True)

    def get(self, script_id: str) -> ScriptMeta:
        if script_id not in self._scripts:
            raise HTTPException(status_code=404, detail="Script not found")
        return self._scripts[script_id]


@dataclass
class AgentConnection:
    agent_id: str
    websocket: WebSocket
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    last_seen: float = field(default_factory=_now)
    meta: Dict[str, Any] = field(default_factory=dict)
    ui_clients: Dict[str, WebSocket] = field(default_factory=dict)
    current_task: Optional[str] = None

    def heartbeat(self, meta: Optional[Dict[str, Any]] = None) -> None:
        self.last_seen = _now()
        if meta:
            self.meta.update(meta)

    async def send(self, payload: Dict[str, Any]) -> None:
        await self.websocket.send_text(json.dumps(payload))


agents: Dict[str, AgentConnection] = {}
tasks: Dict[str, TaskRecord] = {}
buffered_tasks: Dict[str, List[Dict[str, Any]]] = {}
script_store = ScriptStore(SCRIPTS_DIR)

app = FastAPI(title="Airtest Remote Cloud Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def ensure_directories() -> None:
    for folder in (SCRIPTS_DIR, RESULTS_DIR):
        folder.mkdir(parents=True, exist_ok=True)


ensure_directories()


async def broadcast_to_ui(agent_id: str, payload: Dict[str, Any]) -> None:
    connection = agents.get(agent_id)
    if not connection:
        return
    dead_clients = []
    for client_id, ws in connection.ui_clients.items():
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            dead_clients.append(client_id)
    for client_id in dead_clients:
        connection.ui_clients.pop(client_id, None)


async def handle_agent_message(conn: AgentConnection, message: Dict[str, Any]) -> None:
    msg_type = message.get("type")
    if msg_type in {"heartbeat", "hello"}:
        conn.heartbeat(message.get("meta", {}))
        await broadcast_to_ui(
            conn.agent_id,
            {
                "type": "agent_status",
                "agent_id": conn.agent_id,
                "last_seen": conn.last_seen,
                "meta": conn.meta,
            },
        )
    elif msg_type == "signaling":
        await broadcast_to_ui(
            conn.agent_id,
            {"type": "signaling", "agent_id": conn.agent_id, "payload": message.get("payload")},
        )
    elif msg_type == "task_result":
        task_id = message.get("task_id")
        record = tasks.get(task_id)
        if not record:
            return
        record.status = message.get("status", TaskStatus.SUCCEEDED)
        record.message = message.get("message", "")
        record.artifacts.update(message.get("artifacts", {}))
        record.updated_at = _now()
        conn.current_task = None
        await broadcast_to_ui(
            conn.agent_id,
            {"type": "task_result", "task_id": task_id, "status": record.status, "message": record.message},
        )
    elif msg_type == "log":
        await broadcast_to_ui(conn.agent_id, {"type": "log", "agent_id": conn.agent_id, "message": message.get("message", "")})
    else:
        logger.warning("Unhandled message from agent %s: %s", conn.agent_id, message)


async def drain_agent_queue(conn: AgentConnection) -> None:
    while True:
        payload = await conn.queue.get()
        try:
            if payload.get("type") == "run_task":
                task_id = payload.get("task_id")
                if task_id in tasks:
                    tasks[task_id].status = TaskStatus.RUNNING
                    tasks[task_id].updated_at = _now()
                    conn.current_task = task_id
            await conn.send(payload)
            logger.info("Sent task to agent %s: %s", conn.agent_id, payload.get("task_id"))
        except Exception as exc:
            logger.error("Failed to send task to agent %s: %s", conn.agent_id, exc)
            conn.queue.put_nowait(payload)
            raise


def enqueue_task(agent_id: str, task: Dict[str, Any]) -> None:
    if agent_id in agents:
        agents[agent_id].queue.put_nowait(task)
        return
    buffered_tasks.setdefault(agent_id, []).append(task)


def hydrate_buffered_tasks(agent_id: str, conn: AgentConnection) -> None:
    tasks_for_agent = buffered_tasks.pop(agent_id, [])
    for task in tasks_for_agent:
        conn.queue.put_nowait(task)


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/agents", response_model=List[AgentInfo])
async def list_agents() -> List[AgentInfo]:
    output: List[AgentInfo] = []
    for agent_id, conn in agents.items():
        output.append(
            AgentInfo(
                id=agent_id,
                online=True,
                last_seen=conn.last_seen,
                meta=conn.meta,
                current_task=conn.current_task,
                queue_size=conn.queue.qsize(),
            )
        )
    for agent_id, pending in buffered_tasks.items():
        if agent_id in agents:
            continue
        output.append(
            AgentInfo(
                id=agent_id,
                online=False,
                last_seen=0,
                meta={},
                current_task=None,
                queue_size=len(pending),
            )
        )
    return sorted(output, key=lambda a: a.id)


@app.post("/api/scripts/upload", response_model=ScriptMeta)
async def upload_script(file: UploadFile = File(...)) -> ScriptMeta:
    if not file.filename.endswith(".air"):
        raise HTTPException(status_code=400, detail="Only .air files are accepted")
    return await script_store.add(file)


@app.get("/api/scripts", response_model=List[ScriptMeta])
async def list_scripts() -> List[ScriptMeta]:
    return script_store.list()


@app.get("/api/scripts/{script_id}")
async def download_script(script_id: str):
    meta = script_store.get(script_id)
    path = SCRIPTS_DIR / meta.stored_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Script content missing")
    return FileResponse(path, filename=meta.filename)


@app.post("/api/agents/{agent_id}/tasks", response_model=TaskRecord)
async def create_task(agent_id: str, payload: CreateTaskRequest) -> TaskRecord:
    meta = script_store.get(payload.script_id)
    if not (SCRIPTS_DIR / meta.stored_name).exists():
        raise HTTPException(status_code=404, detail="Script content missing")
    task_id = uuid.uuid4().hex
    record = TaskRecord(
        id=task_id,
        agent_id=agent_id,
        script_id=payload.script_id,
        variables=payload.variables,
        status=TaskStatus.QUEUED,
    )
    tasks[task_id] = record
    enqueue_task(
        agent_id,
        {
            "type": "run_task",
            "task_id": task_id,
            "script_id": payload.script_id,
            "script_name": meta.filename,
            "script_url": f"/api/scripts/{payload.script_id}",
            "variables": payload.variables,
        },
    )
    await broadcast_to_ui(agent_id, {"type": "task_created", "task_id": task_id})
    return record


@app.get("/api/agents/{agent_id}/tasks", response_model=List[TaskRecord])
async def list_tasks(agent_id: str) -> List[TaskRecord]:
    return [task for task in tasks.values() if task.agent_id == agent_id]


@app.post("/api/tasks/{task_id}/result", response_model=TaskRecord)
async def upload_task_result(
    task_id: str,
    status: str = Form(...),
    message: str = Form(""),
    log_file: Optional[UploadFile] = File(None),
    report_file: Optional[UploadFile] = File(None),
) -> TaskRecord:
    record = tasks.get(task_id)
    if not record:
        raise HTTPException(status_code=404, detail="Task not found")
    record.status = status
    record.message = message
    record.updated_at = _now()

    if log_file or report_file:
        result_dir = RESULTS_DIR / task_id
        result_dir.mkdir(parents=True, exist_ok=True)
        for name, upload in (("log", log_file), ("report", report_file)):
            if not upload:
                continue
            dest = result_dir / upload.filename
            async with aiofiles.open(dest, "wb") as f:
                while chunk := await upload.read(1024 * 1024):
                    await f.write(chunk)
            record.artifacts[name] = str(dest.relative_to(BASE_DIR))
    await broadcast_to_ui(record.agent_id, {"type": "task_result", "task_id": task_id, "status": status})
    return record


@app.websocket("/ws/agent/{agent_id}")
async def agent_socket(websocket: WebSocket, agent_id: str) -> None:
    await websocket.accept()
    conn = AgentConnection(agent_id=agent_id, websocket=websocket)
    agents[agent_id] = conn
    hydrate_buffered_tasks(agent_id, conn)
    drain_task = asyncio.create_task(drain_agent_queue(conn))
    logger.info("Agent connected: %s", agent_id)
    try:
        await websocket.send_text(json.dumps({"type": "welcome", "agent_id": agent_id}))
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Invalid JSON from agent %s: %s", agent_id, raw)
                continue
            await handle_agent_message(conn, message)
    except WebSocketDisconnect:
        logger.info("Agent disconnected: %s", agent_id)
    finally:
        drain_task.cancel()
        agents.pop(agent_id, None)


@app.websocket("/ws/ui/{client_id}")
async def ui_socket(websocket: WebSocket, client_id: str, agent_id: str) -> None:
    await websocket.accept()
    conn = agents.get(agent_id)
    if conn:
        conn.ui_clients[client_id] = websocket
        await websocket.send_text(
            json.dumps(
                {
                    "type": "agent_status",
                    "agent_id": agent_id,
                    "last_seen": conn.last_seen,
                    "meta": conn.meta,
                    "queue_size": conn.queue.qsize(),
                }
            )
        )
    logger.info("UI client %s connected for agent %s", client_id, agent_id)
    try:
        while True:
            raw = await websocket.receive_text()
            message = json.loads(raw)
            msg_type = message.get("type")
            if msg_type in {"signaling", "control"}:
                agent = agents.get(agent_id)
                if not agent:
                    await websocket.send_text(json.dumps({"type": "error", "message": "Agent offline"}))
                    continue
                await agent.send(message)
            elif msg_type == "enqueue_task":
                task_payload = CreateTaskRequest(**message["payload"])
                record = await create_task(agent_id, task_payload)
                await websocket.send_text(json.dumps({"type": "task_created", "task": record.model_dump()}))
            else:
                await websocket.send_text(json.dumps({"type": "error", "message": f"Unknown message {msg_type}"}))
    except WebSocketDisconnect:
        logger.info("UI client %s disconnected", client_id)
    finally:
        if conn:
            conn.ui_clients.pop(client_id, None)


if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="ui")
