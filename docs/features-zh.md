# 軟體功能說明

本文件只描述目前程式碼已存在的功能。

## 系統角色

### Web Console

瀏覽器操作介面，位於 `super_rescuer/frontend`，由 Server 直接提供靜態檔案。

目前包含：

- 登入與登出。
- 可透過 `Ctrl+Shift+U` 顯示 Server URL 設定。
- Device Wall 顯示目前上線的 Agent，以及各 Agent 的 Airtest 任務狀態。
- 選擇 Agent 後派發 Airtest 任務。
- 多台 Agent 可同時執行任務；每台 Agent 各自追蹤 task id 與 Running/Stopping 狀態。
- 任務執行中可對指定 Agent 送出 Stop Task，要求該 Agent 終止目前 Airtest subprocess。
- 上傳 `.air` 或 `.zip` 腳本。
- 任務變數輸入，格式為 JSON。
- Airtest Logs 即時顯示 Agent 回傳的 log 與任務結果。
- Admin 使用者可進入 User Management。
- Audit Log 頁面可查看近期 audit。

### Server

Server 位於 `super_rescuer/server`，負責 API、WebSocket relay、靜態前端與本機 JSON 儲存。

主要能力：

- 建立預設管理員 `admin / admin123`。
- 登入後回傳 bearer token。
- 以記憶體 session 驗證使用者。
- Admin 可建立、修改、刪除使用者。
- 儲存與列出已連線裝置狀態。
- 接收 `.air` / `.zip` 腳本上傳。
- 提供腳本下載給已登入使用者或帶有正確 `X-Device-Key` 的 Agent。
- 透過 WebSocket 將 `run_task` 指令送到指定 Agent。
- 透過 WebSocket 將 `stop_task` 指令送到指定 Agent；HTTP 任務結果也會帶回 `deviceId` 供多機台 UI 對應。
- 接收 Agent 回傳的 log、task result 與 report upload 通知。
- 儲存 audit log；目前程式碼主要記錄登入與使用者管理事件。

主要 API：

| API | 用途 |
| --- | --- |
| `GET /api/health` | 健康檢查 |
| `POST /api/login` | 登入 |
| `GET /api/me` | 取得目前使用者 |
| `GET /api/users` | Admin 列出使用者 |
| `POST /api/users` | Admin 建立使用者 |
| `PATCH /api/users/:id` | Admin 修改密碼或角色 |
| `DELETE /api/users/:id` | Admin 刪除使用者 |
| `GET /api/devices` | 列出裝置/Agent |
| `GET /api/audits` | 取得近期 audit |
| `GET /api/scripts` | 列出已上傳腳本 |
| `POST /api/scripts/upload` | 上傳 `.air` 或 `.zip` |
| `GET /api/scripts/:id` | 下載腳本 |
| `POST /api/tasks/:id/result` | Agent 上傳任務結果 |

主要 WebSocket：

| 路徑 | 用途 |
| --- | --- |
| `/ws/operator` | Web Console 連線，需先送出 auth token |
| `/ws/device` | Airtest Agent 連線，需使用 `DEVICE_SHARED_KEY` hello |

### Airtest Agent

Agent 位於 `airtest_agent`，是 Python 執行端。

主要能力：

- 連線到 Server `/ws/device`。
- 使用 `DEVICE_SHARED_KEY` 驗證。
- 以 `AGENT_ID` 顯示在 Device Wall。
- 定期回報狀態，讓 Console 判斷上線。
- 使用 ADB 偵測 Android 裝置。
- 接收 `run_task` 後下載指定腳本。
- 接收 `stop_task` 後終止目前執行中的 Airtest subprocess。
- 支援 `.zip` 解壓並尋找 `.air` 目錄。
- 執行 `airtest run`。
- 將 JSON 任務變數轉為環境變數傳給 Airtest 程序。
- 即時回傳 stdout log。
- 執行後產生 `airtest report` 與 zip 檔。
- 上傳 stdout log 與 report zip 到 Server。

## Airtest 任務流程

1. 操作者在 Web Console 上傳 `.air` 或 `.zip`。
2. Server 儲存檔案與 metadata。
3. 操作者選取上線 Agent 與腳本。
4. Web Console 透過 `/ws/operator` 發送 `run_task`。
5. Server 將任務轉送到指定 Agent。
6. Agent 下載腳本並透過 ADB 選取 Android 裝置。
7. Agent 執行 `airtest run`。
8. Agent 即時將 log 傳回 Console。
9. 若操作者按 Stop Task，Agent 會中止目前 subprocess，回傳 `stopped`。
10. Agent 產生 report zip 並呼叫 `/api/tasks/:id/result` 上傳結果。
11. Console 顯示任務成功、失敗或停止。

## 權限與角色

目前角色：

| 角色 | 能力 |
| --- | --- |
| `admin` | 登入、查看裝置、上傳與執行 Airtest、查看 audit、管理使用者 |
| `operator` | 登入、查看裝置、上傳與執行 Airtest、查看 audit |

## 目前沒有的功能

以下功能不在目前程式碼中，文件已移除相關部署與操作說明：

- Android APK 專案與安裝流程。
- 手機或機器人即時畫面串流。
- WebRTC / WebCodecs 播放。
- 遠端檔案總管。
- 遠端 Shell 終端機 UI。
- TTS 控制。
- 錄影列表與串流 API。
- React 前端或 FastAPI 後端。
