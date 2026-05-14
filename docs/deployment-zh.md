# 部署說明

本文件依照目前程式碼整理部署方式，包含 Web Console/Server 與 Airtest Agent。舊版 Android 串流 App、WebRTC、WebCodecs 與檔案總管相關部署已不在目前程式碼中。

## 1. Web Console / Server

Server 位於 `super_rescuer/server`，使用 Node.js、Express 與 `ws`，並直接託管 `super_rescuer/frontend` 靜態頁面。

### 伺服器需求

- Linux 主機
- Docker Engine
- Docker Compose plugin
- 對操作者與 Agent 開放 TCP `13000`，或你指定的 `RIDER_HOST_PORT`

### 一鍵部署

```bash
cd super_rescuer
bash deploy-web.sh
```

完成後開啟：

```text
http://<server-ip>:13000
```

健康檢查：

```bash
curl http://127.0.0.1:13000/api/health
```

正確回應：

```json
{"status":"ok"}
```

預設帳號：

```text
admin / admin123
```

第一次登入後請建立新管理員或修改預設密碼。

### 常用部署參數

可以直接用環境變數覆蓋：

```bash
RIDER_HOST_PORT=13001 DEVICE_SHARED_KEY=change-me bash deploy-web.sh
```

也可以建立 `super_rescuer/.env`：

```bash
cd super_rescuer
cp .env.example .env
nano .env
bash deploy-web.sh
```

主要參數：

| 參數 | 預設值 | 說明 |
| --- | --- | --- |
| `RIDER_HOST_PORT` | `13000` | 主機對外服務 port |
| `RIDER_BIND_ADDR` | `0.0.0.0` | 綁定位址；若放在反向代理後可用 `127.0.0.1` |
| `DEVICE_SHARED_KEY` | `nuwa8888` | Agent 連線與下載腳本使用的 shared key |
| `SUPER_RESCUER_DATA_DIR` | `/opt/super-rescuer/data` | `store.json` 持久化目錄 |
| `SUPER_RESCUER_RECORDINGS_DIR` | `/opt/super-rescuer/recordings` | recordings 掛載目錄，目前程式碼未提供錄影查詢 API |
| `ALLOWED_ORIGINS` | `*` | CORS 允許來源 |
| `WS_FRAME_DEBUG` | `1` | WebSocket frame debug log |

### Docker Compose 手動部署

```bash
cd super_rescuer
docker compose up -d --build
```

查看 log：

```bash
docker compose logs -f server
```

停止服務：

```bash
docker compose down
```

### 本機開發啟動

```bash
cd super_rescuer/server
npm install
npm start
```

本機預設網址：

```text
http://localhost:3000
```

注意：本機直接 `npm start` 時，server 程式碼的 `DEVICE_SHARED_KEY` 預設是 `rider-dev-key`；Docker Compose 預設是 `nuwa8888`。

### HTTPS / 反向代理

目前 UI 主要用 REST 與 WebSocket，不依賴 WebCodecs。不過若部署在公開網路，仍建議使用 HTTPS 並限制來源。

若主機已有 Nginx、Caddy 或其他反向代理，可讓 Docker 只綁本機：

```bash
RIDER_BIND_ADDR=127.0.0.1 bash deploy-web.sh
```

反向代理目標：

```text
http://127.0.0.1:13000
```

如果使用 HTTPS 網域，Airtest Agent 的 `CLOUD_SERVER` 請使用 `wss://<domain>`。

## 2. Airtest Agent

Agent 位於 `airtest_agent`，會連到 Server 的 `/ws/device`，並以裝置身分出現在 Web Console 的 Device Wall。

### Agent 主機需求

- Python 3.10+ 或相容版本
- ADB 已安裝且在 `PATH` 中，或設定 `ADB_BIN`
- Android 裝置已開啟 USB debugging，且 `adb devices` 可看到 `device`
- 可以連線到 Web Server 的 `13000` 或反向代理網址

確認 ADB：

```bash
adb devices
```

### Linux / macOS

從 repo 根目錄執行：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r airtest_agent/requirements.txt

CLOUD_SERVER=ws://<server-ip>:13000 \
DEVICE_SHARED_KEY=nuwa8888 \
AGENT_ID=agent-01 \
python -m airtest_agent.main
```

### Windows PowerShell

從 repo 根目錄執行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r airtest_agent\requirements.txt

$env:CLOUD_SERVER = "ws://<server-ip>:13000"
$env:DEVICE_SHARED_KEY = "nuwa8888"
$env:AGENT_ID = "agent-01"
python -m airtest_agent.main
```

### Agent 環境變數

| 參數 | 預設值 | 說明 |
| --- | --- | --- |
| `CLOUD_SERVER` | `ws://localhost:8081` | Server WebSocket base URL；部署時請明確設定 |
| `DEVICE_SHARED_KEY` | `rider-dev-key` | 必須與 Server 相同 |
| `AGENT_ID` | 隨機 8 碼 | Console 上顯示的裝置 ID |
| `ADB_SERIAL` | 未設定 | 指定特定 ADB 裝置 |
| `ADB_WIFI` | 未設定 | 無 USB 裝置時嘗試 `adb connect <host:port>` |
| `ADB_BIN` | `adb` | ADB 執行檔路徑 |
| `AGENT_DATA` | `/tmp/airtest_agent` | 腳本、log、report 工作目錄 |

## 3. 初次操作流程

1. 部署 Web Console / Server。
2. 登入 `http://<server-ip>:13000`。
3. 啟動 Airtest Agent，並確認 Device Wall 出現該 Agent。
4. 上傳 `.air` 或 `.zip` 腳本。
5. 選取 Agent 與腳本。
6. 可選：輸入 JSON 變數，例如 `{"ENV":"qa","ROBOT_ID":"robot-01"}`。這些變數會以環境變數形式傳給該次 Airtest 執行程序；詳細格式、型別轉換與腳本讀取方式請看 [features-zh.md](features-zh.md#任務-json-變數用法)。
7. 點擊 Run Task。
8. 多台 Agent 可同時執行；Device Wall 會顯示各台的 Airtest 狀態。
9. 任務執行中可對指定 Agent 點擊 Stop Task，中止該台目前 Airtest subprocess。
10. 從 Airtest Logs 查看即時輸出與任務結果。

## 4. 維運注意事項

- `store.json` 儲存使用者、裝置、任務、audit 與腳本 metadata。
- Session 存在記憶體，Server 重啟後需要重新登入。
- 上傳腳本預設放在 Server 的 `scripts` 目錄；目前 Docker Compose 未掛載該目錄，重建容器前請備份或自行新增 volume。
- `DEVICE_SHARED_KEY` 請在正式環境改掉，且 Server 與所有 Agent 必須一致。
- 若 Agent 顯示離線，優先檢查 `CLOUD_SERVER`、防火牆、shared key 與 WebSocket 反向代理設定。
- 若 Airtest 任務失敗，先在 Agent 主機確認 `adb devices` 與本機 `airtest run` 是否正常。
