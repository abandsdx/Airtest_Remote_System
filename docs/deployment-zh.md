# 部署說明

這份文件說明目前程式碼的部署方式。系統分成兩部分：

- Web Console / Server：Node.js + Express + WebSocket，建議用 Docker 部署。
- Airtest Agent：Python 程式，部署在能連到 Android 裝置與 ADB 的機器上。

目前專案不包含 Android App、WebRTC 或 WebCodecs 串流部署。

## 1. Web Console / Server

位置：`super_rescuer`

Server container 內部使用 port `3000`，Docker Compose 預設映射到主機 port `13000`。

### 系統需求

- Linux 主機。
- Docker Engine。
- Docker Compose plugin，也就是可執行 `docker compose version`。
- Agent 機器可以連到 Server 的主機 port，預設是 `13000`。

### 建議部署方式

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

預期回應：

```json
{"status":"ok"}
```

預設登入帳號：

```text
admin / admin123
```

第一次上線後請到 User Management 建立正式帳號，並修改或移除預設帳號。

## 2. deploy-web.sh 和 docker compose 的差異

兩者最後都會使用 Docker Compose 啟動 `server`，但用途不同。

### `bash deploy-web.sh`

這是建議給部署人員使用的包裝腳本。

它會做這些事：

- 自動切到 `super_rescuer` 目錄。
- 如果存在 `.env`，會先載入 `.env`。
- 設定預設值：
  - `RIDER_HOST_PORT=13000`
  - `RIDER_BIND_ADDR=0.0.0.0`
  - `DEVICE_SHARED_KEY=nuwa8888`
  - `WS_FRAME_DEBUG=1`
  - `SUPER_RESCUER_DATA_DIR=/opt/super-rescuer/data`
  - `SUPER_RESCUER_RECORDINGS_DIR=/opt/super-rescuer/recordings`
  - `SUPER_RESCUER_SCRIPTS_DIR=/opt/super-rescuer/scripts`
- 檢查 Docker 是否存在。
- 檢查 Docker Compose plugin 是否存在。
- 執行 `docker compose up -d --build server`。
- 等待 `/api/health` 健康檢查。
- 印出 Web Console URL、health check URL、預設帳號與 shared key。

適合：

- 第一次部署。
- 給不熟 Docker Compose 細節的人操作。
- 希望部署後自動檢查服務是否起來。

### `docker compose up -d --build`

這是直接呼叫 Docker Compose。

它只會依照 `docker-compose.yml` 與目前 shell 環境變數啟動服務，不會做額外檢查，也不會等待 health check。

適合：

- 熟悉 Docker Compose 的維運人員。
- CI/CD。
- 只想直接重建或重啟服務。

注意：

- 如果你沒有先設定環境變數，Compose 會使用 `docker-compose.yml` 裡的預設值。
- 如果你希望使用 `.env`，請確認 `.env` 位於 `super_rescuer/.env`，並且你是在 `super_rescuer` 目錄執行。
- `deploy-web.sh` 只啟動 `server` service；目前 compose 檔也只有這個 service。

直接使用 Compose：

```bash
cd super_rescuer
docker compose up -d --build
```

查看 log：

```bash
docker compose logs -f server
```

停止：

```bash
docker compose down
```

## 3. 環境變數

可以用單次命令設定：

```bash
RIDER_HOST_PORT=13001 DEVICE_SHARED_KEY=change-me bash deploy-web.sh
```

也可以建立 `.env`：

```bash
cd super_rescuer
cp .env.example .env
nano .env
bash deploy-web.sh
```

主要環境變數：

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `RIDER_HOST_PORT` | `13000` | 主機對外提供 Web Console / API / WebSocket 的 port |
| `RIDER_BIND_ADDR` | `0.0.0.0` | 主機 bind 位址；若只給本機 reverse proxy 用，可設 `127.0.0.1` |
| `DEVICE_SHARED_KEY` | `nuwa8888` | Server 和 Agent 共用驗證 key，Agent 必須一致 |
| `SUPER_RESCUER_DATA_DIR` | `/opt/super-rescuer/data` | Server `store.json` 與持久化資料位置 |
| `SUPER_RESCUER_RECORDINGS_DIR` | `/opt/super-rescuer/recordings` | recordings volume，目前保留給系統資料 |
| `SUPER_RESCUER_SCRIPTS_DIR` | `/opt/super-rescuer/scripts` | Uploaded Scripts 實體檔案持久化位置 |
| `SUPER_RESCUER_DB_DIR` | `/opt/super-rescuer/db` | Postgres 任務歷史與統計資料位置 |
| `SUPER_RESCUER_DB_PASSWORD` | `super_rescuer_pass` | Postgres `super_rescuer` 使用者密碼，正式環境請修改 |
| `ALLOWED_ORIGINS` | `*` | CORS 允許來源；正式環境建議指定網域 |
| `WS_FRAME_DEBUG` | `1` | WebSocket frame debug log |

上傳腳本目錄：

- 程式支援 `SCRIPTS_DIR`。
- Docker Compose 會把主機 `SUPER_RESCUER_SCRIPTS_DIR` 掛載到 container 的 `/usr/src/app/scripts`。
- Compose 會設定 `SCRIPTS_DIR=/usr/src/app/scripts`。
- 因此 Uploaded Scripts 的 metadata 和實體檔都會跨 container 重建保存。

## 4. 本機開發啟動 Server

不使用 Docker 時：

```bash
cd super_rescuer/server
npm install
npm start
```

本機預設：

```text
http://localhost:3000
```

注意：

- 本機 `npm start` 的 `DEVICE_SHARED_KEY` 預設是 `rider-dev-key`。
- Docker 部署的 `DEVICE_SHARED_KEY` 預設是 `nuwa8888`。
- 兩邊不同時，Agent 會連不上或驗證失敗。
- 新增資料夾上傳功能後，Server 需要 `jszip` dependency；請重新執行 `npm install` 或重新 build Docker image。

## 5. Airtest Agent 部署

位置：repo 根目錄的 `airtest_agent`

### Agent 系統需求

- Python 3.10+。
- 已安裝 Airtest CLI，且可執行 `airtest`。
- 已安裝 ADB，且 `adb` 在 PATH，或透過環境設定指定。
- Android 裝置已開啟 USB debugging。
- Agent 機器可連到 Server，例如 `ws://<server-ip>:13000`。

檢查 ADB：

```bash
adb devices
```

應看到目標裝置狀態為 `device`。

### Windows PowerShell

在 repo 根目錄執行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r airtest_agent\requirements.txt

$env:CLOUD_SERVER = "ws://<server-ip>:13000"
$env:DEVICE_SHARED_KEY = "nuwa8888"
$env:AGENT_ID = "agent-01"
python -m airtest_agent.main
```

### Linux / macOS

在 repo 根目錄執行：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r airtest_agent/requirements.txt

CLOUD_SERVER=ws://<server-ip>:13000 \
DEVICE_SHARED_KEY=nuwa8888 \
AGENT_ID=agent-01 \
python -m airtest_agent.main
```

### `python -m airtest_agent.main` 執行哪個檔案

這個命令會執行：

```text
airtest_agent/main.py
```

流程：

1. Python 以 module 方式載入 `airtest_agent.main`。
2. 執行 `airtest_agent/main.py` 最下方的 `asyncio.run(main())`。
3. `main()` 讀取 `AgentConfig.from_env()`。
4. 建立 `AgentClient`。
5. 啟動 `DeviceDetector`。
6. 呼叫 `agent.run()`，連到 Server `/ws/device`。

使用 `-m` 的好處是 Python 會把 repo 根目錄視為 package 搜尋路徑，讓相對 import 正常運作。

### Agent 環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `CLOUD_SERVER` | `ws://localhost:8081` | Server WebSocket base URL；Docker 部署通常是 `ws://<server-ip>:13000` |
| `DEVICE_SHARED_KEY` | `rider-dev-key` | 必須和 Server 的 `DEVICE_SHARED_KEY` 一致 |
| `AGENT_ID` | 隨機 8 碼 | 顯示在 Device Wall 的 Agent ID |
| `ADB_SERIAL` | 空 | 指定 ADB 裝置 serial |
| `AGENT_DATA` | `/tmp/airtest_agent` | Agent 工作目錄，保存下載腳本、log、report |
| `AIRTEST_EXTRA_PYTHONPATH` | 空 | 額外加入 Airtest subprocess 的 Python 搜尋路徑，可放共用模組如 `nuwa_commons` |

Agent 會把 ADB serial 轉成 Airtest CLI 使用的 device URI：

```text
Android://127.0.0.1:5037/<serial>
```

如果 `adb devices` 顯示 serial 是 `ABC123`，實際執行 Airtest 時會使用：

```text
--device Android://127.0.0.1:5037/ABC123
```

## 6. 上線後操作流程

1. 部署 Server。
2. 登入 Web Console。
3. 啟動一台或多台 Airtest Agent。
4. 確認 Agent 出現在 Device Wall。
5. 上傳 `.zip`，或用 Upload Folder 選擇 `.air` 專案資料夾。
6. 在 Uploaded Scripts 確認上傳時間、上傳者、類型與檔案數。
7. Select 腳本。
8. 選擇 Agent。
9. 可選：輸入 JSON 變數，例如 `{"ENV":"qa","ROBOT_ID":"robot-01"}`。
10. 點擊 Run Task。
11. 若需要停止，選定正在執行的 Agent 後點 Stop Task，或使用 Device Wall 上該 Agent 的停止操作。
12. 在 Airtest Logs 查看即時輸出與結果。

## 7. 資料與備份

需要備份：

- `SUPER_RESCUER_DATA_DIR`：包含 `store.json`。
- `SUPER_RESCUER_SCRIPTS_DIR`：包含 Uploaded Scripts 的 `.zip` 與資料夾上傳後產生的 ZIP。
- `SUPER_RESCUER_DB_DIR`：包含 Postgres 任務歷史與 `[STAT]` 統計資料。
- Agent 端 `AGENT_DATA`：包含下載腳本、執行 log 與 report zip。

建議正式環境：

- 設定固定的 `DEVICE_SHARED_KEY`。
- 設定非預設 admin 帳號。
- 限制 `ALLOWED_ORIGINS`。
- 用 reverse proxy 提供 HTTPS。
- 定期備份上傳腳本持久化 volume。
- 定期備份 `store.json`、上傳腳本與 Postgres DB。

### 任務歷史 DB 驗證

部署後會多一個獨立 Postgres container：

```text
super-rescuer-db
```

確認 DB container：

```bash
docker ps --filter name=super-rescuer-db
```

查任務表：

```bash
docker exec -it super-rescuer-db psql -U super_rescuer -d super_rescuer -c "select task_id, device_id, script_name, status, duration_ms from task_runs order by started_at desc limit 10;"
```

查單次任務 `[STAT]`：

```bash
docker exec -it super-rescuer-db psql -U super_rescuer -d super_rescuer -c "select task_id, stat_key, stat_value, stat_number, stat_type from task_stats order by updated_at desc limit 20;"
```

也可以用 Web API 查：

```bash
curl -H "Authorization: Bearer <login-token>" http://127.0.0.1:13000/api/task-runs
curl -H "Authorization: Bearer <login-token>" http://127.0.0.1:13000/api/task-runs/<task-id>/stats
```

## 8. 常見問題

### Agent 看不到 Server

檢查：

- `CLOUD_SERVER` 是否是 `ws://<server-ip>:13000`。
- Server 防火牆是否開放 `RIDER_HOST_PORT`。
- `DEVICE_SHARED_KEY` 是否一致。
- Server log 是否有 WebSocket 驗證錯誤。

### `docker compose up -d --build` 可以，為什麼還要 `deploy-web.sh`

`deploy-web.sh` 是部署包裝腳本，會設定預設值、讀 `.env`、檢查 Docker/Compose、啟動服務並做 health check。直接 `docker compose up -d --build` 不會做這些檢查。

### 上傳資料夾後 Agent 執行哪個 `.air`

Server 會把資料夾壓成 ZIP。Agent 下載後解壓縮，尋找第一個 `.air` 目錄並執行。建議一個上傳資料夾內只放一個主要 `.air` 專案，避免選到非預期目錄。

注意：Airtest 的 `.air` 是資料夾，不是單一檔案。請不要用 Upload ZIP 上傳一個叫 `script.air` 的單一檔案；那會讓 Airtest 嘗試讀取 `script.air/script.py` 並失敗。正確做法是用 Upload Folder 選 `script.air/` 資料夾，或上傳包含 `script.air/` 資料夾的 ZIP。

如果腳本需要 `nuwa_commons.py`、`common/` 這類共用 Python 模組，有兩種做法：跟著任務一起上傳，或放在 Agent 的 `AIRTEST_EXTRA_PYTHONPATH` 共用路徑。Agent 會把 `.air` 目錄與解壓後上一層目錄加入 `PYTHONPATH`；若有設定 `AIRTEST_EXTRA_PYTHONPATH`，也會一起加入。

如果你的原始目錄是 `Merge/`，裡面同時有很多 `.air` 專案和 `nuwa_commons/`，不要直接上傳整個 `Merge/`。請建立只包含目標專案與共用模組的資料夾，例如：

```text
Superdeliver_package/
|-- Superdeliver.air/
`-- nuwa_commons/
```

再用 Upload Folder 上傳 `Superdeliver_package/`。這樣 Agent 只會找到一個 `.air` 專案，且 `nuwa_commons` 會在 `PYTHONPATH` 搜尋範圍內。

如果 `nuwa_commons` 是所有專案共用，建議用 Agent 共用路徑，避免每次共用庫改版都要重包所有 `.air` 專案：

```bash
sudo mkdir -p /opt/airtest-shared
```

把 `nuwa_commons/` 放成：

```text
/opt/airtest-shared/nuwa_commons/
```

systemd service 加上：

```ini
Environment=AIRTEST_EXTRA_PYTHONPATH=/opt/airtest-shared
```

手動啟動 Agent 時則加在同一行：

```bash
AIRTEST_EXTRA_PYTHONPATH=/opt/airtest-shared \
CLOUD_SERVER=ws://192.168.1.82:13000 \
DEVICE_SHARED_KEY=nuwa8888 \
AGENT_ID=nuwa-agent-01 \
python -m airtest_agent.main
```

之後 Upload Folder 可以只上傳 `Superdeliver.air/`。更新 `nuwa_commons` 時，只要更新 Agent 主機上的 `/opt/airtest-shared/nuwa_commons/`；下一次 Run Task 會由新的 Airtest subprocess 讀到更新後內容。

### 有 Pause 嗎

目前沒有 Pause。現在支援的是 Stop Task，會停止目前 Airtest subprocess。

### 多機台同時執行時 Stop 會不會停錯

Stop 訊息包含 `deviceId` 與 `task_id`。Server 會轉發到指定 Agent，Agent 也會確認 task id。多台 Agent 同時執行時，停止其中一台不會影響其他 Agent。
