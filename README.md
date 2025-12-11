# Airtest Remote System / 遠端控制系統

跨網域的 Android 遠端操作與 Airtest 自動化：Cloud Server (FastAPI+WebSocket+Queue) + Pi Agent (ADB+Airtest+WebRTC) + Web UI (React+WebRTC)。

## Highlights / 重點
- WebRTC 跨網域串流：STUN/TURN 可選，低延遲影像 + DataChannel 控制。
- Airtest 佇列：每台 Pi 一條 queue，腳本上傳、下載、結果回傳。
- ADB 控制：USB 優先，無 USB 時自動 WiFi ADB fallback，支援 tap/swipe/text/key。
- 全前端操作：瀏覽器直接觀看、操作、派送 Airtest 任务與讀取日誌。

## Layout / 專案結構
- `cloud_server/`：FastAPI REST、WebSocket signaling、佇列管理、腳本/結果存儲；可托管前端。
- `pi_agent/`：WebSocket 客戶端；ADB 控制、Airtest 執行、WebRTC 佔位串流（可換 scrcpy 管線）。
- `web_ui/`：React + WebRTC Dashboard，含 Agents 列表、裝置控制、Airtest 上傳/執行、日誌檢視。

## Quick Start / 快速開始
### Cloud Server
```bash
cd cloud_server
python -m venv .venv && .venv\Scripts\activate  # PowerShell
pip install -r requirements.txt
uvicorn cloud_server.app:app --host 0.0.0.0 --port 8081 --reload
```
- Scripts 置於 `cloud_server/storage/scripts`；results 置於 `cloud_server/storage/results`。
- 若 `web_ui/dist` 存在，會自動托管前端。

### Docker Compose (Cloud)
```bash
docker compose up --build -d
# Override host port (container still listens on 8081)
CLOUD_PORT=18081 docker compose up -d
```
- 在倉庫根目錄執行；Compose 會依 `cloud_server/Dockerfile` 建置映像。
- `cloud_server/storage` 會以 bind mount 保存腳本與結果。
- 若要同時托管前端，先在 `web_ui` 執行 `npm run build`，Compose 會將 `web_ui/dist` 以唯讀掛載進容器。
- 也可以直接讓 Compose 幫忙建置並啟動前端：`docker compose up --build -d cloud web`，預設前端 5173->80。若 Cloud 埠或網域不同，於建置時帶入 `VITE_API_BASE`、`VITE_WS_BASE`（預設 http://localhost:8081 / ws://localhost:8081）。

### Pi Agent
```bash
cd pi_agent
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
python -m pi_agent.main  # env: CLOUD_SERVER=ws://<server>:8081 AGENT_ID=pi-01
```
- Env：`ADB_SERIAL`、`ADB_WIFI`、`AGENT_DATA`、`STUN_SERVERS`（選用）。
- 自動連線 Cloud，接收任務，透過 DataChannel 將控制指令轉成 ADB 操作。

### Web UI
```bash
cd web_ui
npm install
npm run dev     # http://localhost:5173
npm run build   # 產出 dist/ 由 Cloud Server 托管
```
- `VITE_API_BASE`、`VITE_WS_BASE` 可覆寫 API/WS 端點（預設 http://localhost:8081）。

## Detailed Usage / 詳細使用方式
### 1) 啟動 Cloud Server
- 本機：依「Cloud Server」步驟啟動 uvicorn，確認 `http://<server>:8081/health` 回應 `{"status":"ok"}`。
- Docker Compose：依「Docker Compose (Cloud)」步驟啟動；確保 `cloud_server/storage` 可寫，若要托管前端先建置 `web_ui/dist`。

### 2) 建置並啟動 Web UI
- 開發模式：`npm run dev`，瀏覽器開啟 `http://localhost:5173`，並確認 `.env` 端點指向 Cloud。
- 部署模式：`npm run build`，把 `web_ui/dist` 放到 Cloud，同目錄下啟動 Cloud 即自動托管；或使用 `docker compose up --build -d web` 由 Compose 建置並用 nginx 服務（預設對外埠 `WEB_PORT`=5173）。

### 3) 啟動 Pi Agent
- 設定環境變數後執行：
  ```bash
  CLOUD_SERVER=ws://<server>:8081 AGENT_ID=pi-01 python -m pi_agent.main
  ```
- 如果是 WiFi ADB，預先 `ADB_WIFI=<host:port>`；指定序號則用 `ADB_SERIAL=<serial>`。
- 成功後 Agent 會長連 WebSocket 並定期 heartbeat，`/api/agents` 可看到在線狀態。

### 4) 上傳並執行 Airtest 腳本
- 在 Web UI「Airtest Management」選單上傳 `.air` 檔，系統會存到 Cloud `storage/scripts/`。
- 選取目標 Agent 與腳本，填寫變數(JSON)後按 Run，任務會進入該 Agent 的佇列。
- Agent 收到後執行 `airtest run ...`，stdout/結果會回傳並可在 UI 的 log 區看到。

### 5) 即時控制與串流
- 在「Device Control」頁籤選取 Agent 按 Connect，會透過 WebRTC 建立串流與 DataChannel。
- 目前為佔位黑畫面；要接真實畫面，請在 `pi_agent/webrtc_streamer.py` 將 placeholder track 換成 scrcpy H.264 管線。
- Tap/Text/Key 按鈕會透過 DataChannel 轉為 ADB input，適用於 USB 或 WiFi ADB。

### 6) 成果與下載
- Task 完成後，Cloud 會存放結果到 `storage/results/<task_id>/`（含 log/report 如有上傳）。
- 可透過 REST `/api/tasks/{task_id}/result` 或在 UI 查看狀態；腳本可從 `/api/scripts/{id}` 下載。

## API Quick Reference / API 快速對照
- `GET /health`：健康檢查。
- `GET /api/agents`：列出 Agents 與 queue 狀態。
- `POST /api/scripts/upload` (multipart `file`)：上傳 `.air` 腳本。
- `GET /api/scripts`、`GET /api/scripts/{id}`：列出/下載腳本。
- `POST /api/agents/{agent_id}/tasks`：建立任務 `{ "script_id": "...", "variables": {...} }`。
- `GET /api/agents/{agent_id}/tasks`：查詢該 Agent 任務。
- `POST /api/tasks/{task_id}/result` (multipart)：Agent 上傳結果（log/report）。
- WebSocket：`/ws/agent/{id}`（Agent）、`/ws/ui/{client_id}?agent_id=...`（UI signaling/control）。

### curl 範例 / Example
```bash
# 列出 Agents
curl http://localhost:8081/api/agents

# 上傳腳本
curl -F "file=@sample.air" http://localhost:8081/api/scripts/upload

# 建立任務
curl -H "Content-Type: application/json" -d '{"script_id":"<id>","variables":{"k":"v"}}' \
  http://localhost:8081/api/agents/pi-01/tasks
```

## Frontend Config Sample / 前端設定範例
建立 `web_ui/.env.local`：
```
VITE_API_BASE=http://localhost:8081
VITE_WS_BASE=ws://localhost:8081
```
重新啟動 `npm run dev` 以套用。

## scrcpy 串流接入指引（簡述）
- 目標：用 scrcpy 的 H.264 流取代佔位黑畫面。
- 位置：`pi_agent/webrtc_streamer.py`，將 `DummyVideoStreamTrack` 換成自訂 `VideoStreamTrack`，從 scrcpy/ffmpeg 管線讀取 frame。
- 常見作法（提示）：`scrcpy --video-codec=h264 --no-audio --max-fps 30 --tcp-listen` → ffmpeg 轉 RTP → aiortc `VideoStreamTrack` 消費。確保解析度/codec 與瀏覽器協商一致。
- 測試：先在同網段以 VLC 播放確認 RTP/UDP 是否可用，再接入 WebRTC。

## Environment / 環境設定
- Cloud：`PORT`（可選，預設 8081）。
- Agent：`CLOUD_SERVER`、`AGENT_ID`、`ADB_SERIAL`、`ADB_WIFI`、`AGENT_DATA`、`STUN_SERVERS`。
- Frontend：`VITE_API_BASE`、`VITE_WS_BASE` 指向 Cloud。

## Architecture Snapshot / 架構對照
- Cloud Server：REST、WebSocket signaling、Airtest 任務佇列、腳本/結果存儲、前端靜態檔案托管。
- Pi Agent：ADB 控制（USB/WiFi）、scrcpy H.264 → WebRTC（現為佔位，接口已留）、DataChannel 控制、Airtest 單腳本執行。
- Web UI：Agents Dashboard、WebRTC 播放/控制、Airtest 上傳與執行、Log/Report 瀏覽。
- 跨網域：WebSocket 傳遞 Offer/Answer/ICE，STUN/TURN 支援，無須 VPN/Tailscale。

## Notes / 備註
- WebRTC 影片目前為佔位黑畫面；將 scrcpy/ffmpeg 管線接入 `pi_agent/webrtc_streamer.py` 可推送真實 H.264。
- Airtest 需系統可用 `airtest` CLI，並能透過 ADB 連到 Android 裝置。
- 每台 Pi 一次一支 Airtest，佇列保證順序；可水平擴增 Pi 以提升併發。 
