# Airtest Remote System

這個專案目前實作的是「Web Console + Node.js Server + Python Airtest Agent」的遠端 Airtest 任務執行系統。

操作者從瀏覽器登入控制台，上傳 `.air` 或 `.zip` 腳本，選擇已連線的 Airtest Agent，並透過 WebSocket 派發任務。Agent 端會使用 ADB 找到 Android 裝置、執行 `airtest run`、即時回傳 log，並上傳執行結果。

目前程式碼沒有包含 Android 串流 App，因此文件已不再描述即時畫面、檔案總管、裝置 Shell、TTS、WebCodecs 或 Android APK 部署等舊功能。

## 專案組成

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
    `-- requirements.txt
```

## 快速部署

在 Linux 伺服器上安裝 Docker Engine 與 Docker Compose plugin 後：

```bash
cd super_rescuer
bash deploy-web.sh
```

預設會啟動 Web Console：

```text
http://<server-ip>:13000
```

預設管理員帳號：

```text
admin / admin123
```

如需改 port 或 shared key：

```bash
RIDER_HOST_PORT=13001 DEVICE_SHARED_KEY=change-me bash deploy-web.sh
```

完整部署流程請看 [docs/deployment-zh.md](docs/deployment-zh.md)。

## 快速使用

1. 開啟 `http://<server-ip>:13000` 並登入。
2. 在執行端主機安裝 Python 依賴與 ADB。
3. 啟動 `airtest_agent`，並確認 `DEVICE_SHARED_KEY` 與 server 相同。
4. 在 Web Console 上傳 `.air` 或 `.zip` 腳本。
5. 選取上線的 Agent、選取腳本，必要時輸入 JSON 變數後執行。
6. 多台 Agent 可同時執行；Device Wall 會顯示各台的 Airtest 狀態。
7. 任務執行中可對指定 Agent 按 Stop Task，中止該台目前 Airtest subprocess。
8. 從 Airtest Logs 查看即時輸出與任務結果。

軟體功能範圍請看 [docs/features-zh.md](docs/features-zh.md)。

## 重要限制

- Server 使用本機 JSON 檔儲存資料，沒有外部資料庫。
- Session 存在記憶體中，Server 重啟後需要重新登入。
- Docker Compose 目前只掛載資料與 recordings 目錄；上傳的 Airtest 腳本預設存在容器內，重建容器前請自行備份或另外掛載 `SCRIPTS_DIR`。
- Airtest Agent 需要可用的 `adb` 與已授權的 Android 裝置。
