# Airtest Remote System

這個專案提供一套 Web Console + Node.js Server + Python Airtest Agent 的遠端 Airtest 執行系統。

操作人員在 Web Console 上傳 `.zip`，或直接上傳 Airtest `.air` 專案資料夾，選擇已連線的 Agent 後執行任務。Server 透過 WebSocket 把任務派給 Agent，Agent 下載腳本、使用 ADB 連到 Android 裝置並執行 `airtest run`，再回傳即時 log、任務狀態與報告檔。

目前程式碼不包含 Android App、WebRTC 或 WebCodecs 串流功能；文件只保留部署方式與目前軟體功能說明。

## 目錄

```text
.
|-- README.md
|-- docs/
|   |-- deployment-zh.md
|   `-- features-zh.md
|-- super_rescuer/
|   |-- deploy-web.sh
|   |-- docker-compose.yml
|   |-- .env.example
|   |-- server/
|   `-- frontend/
`-- airtest_agent/
    |-- main.py
    |-- websocket_client.py
    |-- airtest_runner.py
    |-- adb_manager.py
    |-- device_detector.py
    `-- requirements.txt
```

## 快速部署 Server

Linux 主機建議使用 Docker 部署：

```bash
cd super_rescuer
bash deploy-web.sh
```

開啟 Web Console：

```text
http://<server-ip>:13000
```

預設登入帳號：

```text
admin / admin123
```

若要調整 port 或 Agent shared key：

```bash
RIDER_HOST_PORT=13001 DEVICE_SHARED_KEY=change-me bash deploy-web.sh
```

完整部署說明請看 [docs/deployment-zh.md](docs/deployment-zh.md)。

## 快速啟動 Agent

`python -m airtest_agent.main` 會執行 `airtest_agent/main.py`。這個入口會讀取環境變數、建立 `AgentClient`、啟動裝置偵測，並連線到 Server 的 `/ws/device`。

Windows PowerShell 範例：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r airtest_agent\requirements.txt

$env:CLOUD_SERVER = "ws://<server-ip>:13000"
$env:DEVICE_SHARED_KEY = "nuwa8888"
$env:AGENT_ID = "agent-01"
python -m airtest_agent.main
```

Linux / macOS 範例：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r airtest_agent/requirements.txt

CLOUD_SERVER=ws://<server-ip>:13000 \
DEVICE_SHARED_KEY=nuwa8888 \
AGENT_ID=agent-01 \
python -m airtest_agent.main
```

## 基本使用流程

1. 部署 Server，登入 `http://<server-ip>:13000`。
2. 在要執行測試的機器上啟動 Airtest Agent。
3. 確認 Agent 出現在 Device Wall，且 Android 裝置可由 `adb devices` 看到。
4. 在 Airtest 區塊上傳 `.zip`，或用 Upload Folder 選擇 `.air` 專案資料夾。
5. 到 Uploaded Scripts 清單確認檔名、上傳時間、上傳者、類型、大小與檔案數。
6. 選擇腳本與目標 Agent。
7. 可選：輸入 JSON 變數，例如 `{"ENV":"qa","ROBOT_ID":"robot-01"}`。
8. 點擊 Run Task 執行。
9. 執行中可點擊 Stop Task；多台 Agent 同時執行時，Stop 只會送到被選定的那台 Agent。
10. 從 Airtest Logs 查看即時輸出與任務結果。

功能與 JSON 變數詳細說明請看 [docs/features-zh.md](docs/features-zh.md)。

## 重要資料位置

- Server 狀態資料：Docker 內 `/usr/src/app/data/store.json`，預設掛載到主機 `/opt/super-rescuer/data`。
- 上傳腳本：Docker 內 `/usr/src/app/scripts`，預設掛載到主機 `/opt/super-rescuer/scripts`。
- 任務歷史與 `[STAT]` 統計：獨立 Postgres container，預設掛載到主機 `/opt/super-rescuer/db`。
- Agent 工作目錄：由 `AGENT_DATA` 控制；未設定時為 `/tmp/airtest_agent`。
- Agent log/report：每次任務會在 Agent 工作目錄中產生 stdout log 與 report zip，並上傳任務結果到 Server。

## 文件

- [部署說明](docs/deployment-zh.md)
- [功能說明與操作細節](docs/features-zh.md)
