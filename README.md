# Airtest Remote System

跨網遠控 Android：Cloud Server (FastAPI/WebSocket/Queue) + Pi Agent (ADB/Airtest/WebRTC) + Web UI (React/WebRTC)。

## 雲端部署（Docker Compose）
前置：Docker + Docker Compose。

最快：clone 後直接啟動 Cloud（只跑 API，Cloud 會自動托管本機的 `web_ui/dist` 如有）：
```bash
git clone <repo>
cd Airtest_Remote_System
docker compose up --build -d cloud
```
如需要同時建置前端容器（nginx 服務）：`docker compose up --build -d cloud web`

覆寫對外埠口（預設 CLOUD_PORT=8081、WEB_PORT=5173 -> nginx 80）：
```bash
CLOUD_PORT=18081 WEB_PORT=18080 docker compose up --build -d cloud web
```
前端若需指向其他 API/WS 網域或埠，建置 Web 時覆寫：
```bash
VITE_API_BASE=http://<host>:8081 VITE_WS_BASE=ws://<host>:8081 docker compose up --build -d web
```
驗證：`http://<host>:<CLOUD_PORT>/health` 應回 `{"status":"ok"}`；若啟用 web 服務則 `http://<host>:<WEB_PORT>`。

- 資料持久化：`cloud_server/storage` 已以 bind mount 保存腳本與結果。
- 若不使用 nginx/web 容器，只要先 `npm run build` 產生 `web_ui/dist`，Cloud 會直接托管該資料夾。

## Pi Agent 使用
1) 安裝依賴：
```bash
cd pi_agent
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
```
2) 設定環境變數並啟動（必填 `CLOUD_SERVER`、`AGENT_ID`；其餘選填）：
```bash
ADB_WIFI=<host:port> \        # 選用：WiFi ADB
ADB_SERIAL=<serial> \         # 選用：指定序號
AGENT_DATA=<json path> \      # 選用：Agent metadata
STUN_SERVERS=<urls> \         # 選用：WebRTC STUN 列表
CLOUD_SERVER=ws://<server>:8081 AGENT_ID=pi-01 python -m pi_agent.main
```
3) 啟動後 Agent 會長連 Cloud `/ws/agent/{id}` 並回報 heartbeat，任務與控制指令將透過 DataChannel/ADB 執行。

## 常用端點
- 健康檢查：`GET /health`
- 列出 Agent：`GET /api/agents`
- 上傳腳本（.air）：`POST /api/scripts/upload`
- 指定 Agent 建立任務：`POST /api/agents/{agent_id}/tasks`
- 任務結果上傳：`POST /api/tasks/{task_id}/result`
- WebSocket：`/ws/agent/{id}`（Agent）、`/ws/ui/{client_id}?agent_id=...`（UI signaling/control）

## 路徑與輸出
- 腳本：`cloud_server/storage/scripts`
- 任務結果：`cloud_server/storage/results/<task_id>/`（log/report 如有上傳）

## 目錄結構
- `cloud_server/`：FastAPI + WebSocket + 任務/腳本存儲
- `pi_agent/`：ADB + Airtest + WebRTC 客戶端
- `web_ui/`：React/Vite 前端
