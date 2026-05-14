# 功能說明

這份文件以目前程式碼為準，說明 Web Console、Server、Airtest Agent、腳本管理、資料夾上傳、Stop Task 與 JSON 變數用法。

## 系統角色

### Web Console

位置：`super_rescuer/frontend`

主要功能：

- 使用帳號密碼登入。
- 顯示目前登入者與角色。
- Device Wall 顯示已連線 Airtest Agent。
- 選擇單一 Agent 作為 Run Task 的目標。
- 上傳 `.zip`，或直接上傳 Airtest `.air` 專案資料夾。
- 管理 Uploaded Scripts：查看檔名、上傳時間、上傳者、類型、大小、資料夾檔案數、檔案是否仍存在。
- 對已上傳腳本執行 Select、Download、Delete。
- 在 Airtest 區塊輸入 JSON 變數。
- 對選定 Agent 執行 Run Task。
- 對選定 Agent 執行 Stop Task。
- 顯示 Airtest 即時 log 與任務結果。
- Admin 角色可進入 User Management。
- Audit Log 可查看登入、上傳、刪除等操作紀錄。

### Server

位置：`super_rescuer/server`

Server 是 Express + WebSocket 服務，負責：

- 提供 Web Console 靜態檔。
- 管理登入 session。
- 管理使用者。
- 管理裝置/Agent 狀態。
- 儲存上傳腳本 metadata。
- 接收 `.zip` 上傳。
- 接收資料夾上傳，並在 Server 端壓縮成 ZIP。
- 提供腳本下載 API 給 Agent。
- 透過 `/ws/operator` 接收 Web Console 指令。
- 透過 `/ws/device` 與 Airtest Agent 維持連線。
- 將 `run_task`、`stop_task` 指令轉發到指定 Agent。
- 接收 Agent 回傳的 log、task result 與 artifacts。
- 寫入 audit log。

### Airtest Agent

位置：`airtest_agent`

Agent 是 Python 程式，負責：

- 連線到 Server `/ws/device`。
- 使用 `DEVICE_SHARED_KEY` 驗證。
- 使用 `AGENT_ID` 顯示在 Device Wall。
- 偵測本機 Android 裝置。
- 使用 ADB serial 執行 Airtest。
- 執行時會把 ADB serial 轉成 Airtest CLI 可接受的 `Android://127.0.0.1:5037/<serial>` device URI。
- 接收 `run_task`。
- 從 Server 下載腳本。
- 如果下載的是 ZIP，安全解壓縮並尋找第一個 `.air` 目錄。
- 執行 `airtest run <script> --log <log_dir>`。
- 將 Web Console 輸入的 JSON 變數轉成 Airtest subprocess 的環境變數。
- 即時回傳 stdout log。
- 產生 `airtest report`。
- 將 stdout log 與 report zip 上傳到 Server。
- 接收 `stop_task` 並停止目前 Airtest subprocess。

## API 摘要

| API | 說明 |
| --- | --- |
| `GET /api/health` | 健康檢查 |
| `POST /api/login` | 登入 |
| `GET /api/me` | 目前登入者 |
| `GET /api/users` | Admin 取得使用者 |
| `POST /api/users` | Admin 建立使用者 |
| `PATCH /api/users/:id` | Admin 更新使用者 |
| `DELETE /api/users/:id` | Admin 刪除使用者 |
| `GET /api/devices` | 取得 Agent 清單 |
| `GET /api/audits` | 取得 audit log |
| `GET /api/scripts` | 取得 Uploaded Scripts 清單 |
| `POST /api/scripts/upload` | 上傳單一 `.zip` |
| `POST /api/scripts/upload-directory` | 上傳資料夾，Server 壓縮成 ZIP |
| `GET /api/scripts/:id` | 下載已上傳腳本，Web Console 與 Agent 共用 |
| `DELETE /api/scripts/:id` | 刪除已上傳腳本 metadata 與實體檔 |
| `POST /api/tasks/:id/result` | Agent 上傳任務結果 |

WebSocket：

| Path | 說明 |
| --- | --- |
| `/ws/operator` | Web Console 使用，需要登入 token |
| `/ws/device` | Airtest Agent 使用，需要 `DEVICE_SHARED_KEY` |

## 上傳腳本

Airtest 區塊提供兩種上傳方式。

### Upload ZIP

用於上傳單一檔案。

支援格式：

- `.zip`

限制：

- 單一 `.air` 檔案會被 Server 拒絕，因為 Airtest 的 `.air` 專案是資料夾，不是檔案。
- 其他非 `.zip` 副檔名會被 Server 拒絕。
- 上傳後 Server 會記錄 `filename`、`stored_name`、`size`、`uploadedBy`、`createdAt`、`updatedAt`。
- 單一檔案上傳的 `uploadType` 會是 `file`。

適用情境：

- 你已經手動把 `.air` 專案資料夾與依賴資源包成 `.zip`。

### Upload Folder

用於直接選取本機資料夾。

這是上傳 Airtest `.air` 專案的建議方式。`.air` 在 Airtest 裡是資料夾，例如 `login_test.air/`，不是單一檔案。

前端會使用瀏覽器的資料夾選擇能力讀取資料夾內所有檔案與相對路徑，送到 Server。Server 收到後會：

1. 檢查每個檔案的相對路徑。
2. 拒絕絕對路徑、磁碟機路徑、`..` 路徑與重複路徑。
3. 保留資料夾相對結構。
4. 壓縮成 ZIP。
5. 把 ZIP 存入 Uploaded Scripts。
6. 記錄 `uploadType: directory`、`originalDirectoryName`、`fileCount`、`originalSize`。

瀏覽器限制：

- 建議使用 Chrome 或 Edge。
- 這個功能依賴 `webkitdirectory`；部分瀏覽器可能不支援資料夾選擇。

建議資料夾結構：

```text
login_test.air/
|-- login_test.py
|-- account_input.png
|-- password_input.png
`-- tpl_xxx.png
```

也可以選擇上一層資料夾：

```text
suite/
|-- login_test.air/
|   |-- login_test.py
|   `-- account_input.png
`-- common/
    `-- data.json
```

Agent 下載 ZIP 後會解壓縮，並尋找第一個 `.air` 目錄來執行。如果 ZIP 裡沒有 `.air` 目錄，Agent 會把解壓縮根目錄交給 `airtest run`，這通常不是建議用法。

如果 Airtest 腳本有共用 Python 模組，例如：

```python
from nuwa_commons import helper
```

請把 `nuwa_commons.py` 或 `nuwa_commons/` 一起放進上傳內容。Agent 執行時會把 `.air` 目錄與解壓後的上一層目錄加進 `PYTHONPATH`，所以以下兩種都可以被搜尋到：

```text
Superdeliver.air/
|-- Superdeliver.py
`-- nuwa_commons.py
```

或：

```text
suite/
|-- Superdeliver.air/
|   `-- Superdeliver.py
`-- nuwa_commons.py
```

如果原始工作目錄像這樣：

```text
Merge/
|-- AB_Nav.air/
|-- Contact.air/
|-- Superdeliver.air/
`-- nuwa_commons/
```

不要直接上傳整個 `Merge/`，因為裡面有多個 `.air` 專案，Agent 無法知道你要跑哪一個。建議另外建立一個只包含目標專案與共用模組的 package 資料夾：

```text
Superdeliver_package/
|-- Superdeliver.air/
`-- nuwa_commons/
```

然後用 Upload Folder 上傳 `Superdeliver_package/`。

錯誤範例：

```text
script.air
```

如果 `script.air` 是單一檔案，Airtest 會嘗試讀取 `script.air/script.py`，最後出現 `NotADirectoryError`。正確做法是上傳整個 `script.air/` 資料夾，或 ZIP 裡面要包含 `script.air/` 資料夾。

## Uploaded Scripts 管理

Uploaded Scripts 清單會顯示：

| 欄位 | 說明 |
| --- | --- |
| 檔名 | 使用者上傳時的檔名；資料夾上傳會顯示 `<資料夾名>.zip` |
| Uploaded | 上傳時間，也就是 `createdAt` |
| 上傳者 | 執行上傳的登入帳號 |
| 類型 | `File` 或 `Directory ZIP` |
| 檔案數 | 只有資料夾上傳會顯示 |
| Source | 原始資料夾名稱 |
| 大小 | Server 實際儲存檔案大小 |
| Missing file | metadata 存在，但 Server 上實體檔已遺失 |

操作：

| 操作 | 說明 |
| --- | --- |
| Select | 將該腳本帶入 Run Task 的選單 |
| Download | 從 Server 下載原本儲存的檔案 |
| Delete | 刪除 metadata 與 Server 上的實體檔 |

注意事項：

- Delete 不會停止正在執行的 Agent。已經下載到 Agent 工作目錄的任務會繼續執行。
- 若要停止任務，請使用 Stop Task。
- Delete 會寫入 audit log，action 是 `script-delete`。
- 單一檔案上傳會寫入 `script-upload`。
- 資料夾上傳會寫入 `script-upload-directory`。

## Run Task 流程

1. Web Console 選擇腳本。
2. Web Console 選擇 Agent。
3. 使用者可輸入 JSON 變數。
4. 點擊 Run Task。
5. Web Console 透過 `/ws/operator` 送出 `run_task`。
6. Server 檢查目標 `deviceId`，轉發到指定 Agent。
7. Agent 從 Server 下載腳本。
8. 如果是 ZIP，Agent 解壓縮並找 `.air` 目錄。
9. Agent 執行 `airtest run`。
10. Agent 即時回傳 log。
11. Agent 產生 report zip。
12. Agent 上傳任務結果。
13. Web Console 清除該 Agent 的 running 狀態。

每台 Agent 同一時間只接受一個任務。若同一台 Agent 已經在執行任務，再送新的任務，Agent 會回覆 failed，訊息會指出它正在執行哪個 task id。

## Stop Task

Stop Task 是目前已實作的中止機制。

行為：

- Web Console 會記錄每台 Agent 目前執行中的 `task_id`。
- Airtest 區塊的 Stop Task 只針對目前選定的 Agent。
- Device Wall 每張 Agent 卡片也會在該 Agent 執行中時顯示停止操作。
- Stop 送出的訊息包含 `deviceId` 與 `task_id`。
- Server 只會把 `stop_task` 轉發到指定 `deviceId` 的 Agent。
- Agent 收到後會確認 `task_id` 是否是目前任務。
- 若符合，Agent 取消目前 task，並 terminate Airtest subprocess。
- 如果 subprocess 5 秒內沒有結束，Agent 會 kill subprocess。
- 任務結果會回傳 `stopped`。

多機台情境：

- Agent A、Agent B 同時執行時，Stop Agent A 不會影響 Agent B。
- UI 狀態是以 `deviceId` 分開記錄。
- 每台 Agent 的 log 會用 `[deviceId]` 標示。
- 若 Agent 離線，Web Console 會清除該 Agent 的 active task 狀態。

限制：

- Stop 是停止 Airtest subprocess，不會還原 Android 裝置狀態。
- 如果 Airtest 腳本已經對外部系統送出操作，Stop 不會自動回滾那些操作。
- 如果任務卡在無法被 subprocess terminate/kill 正常處理的外部程式，仍可能需要人工清理 Agent 機器上的程序。

## JSON 變數用法

Web Console 的 Airtest JSON 欄位可以輸入 JSON object，例如：

```json
{"ENV":"qa","ROBOT_ID":"robot-01"}
```

資料流：

```text
Web Console JSON input
  -> WebSocket run_task.vars
  -> Airtest Agent
  -> subprocess env
  -> airtest run <script>
  -> Airtest 腳本用 os.getenv(...) 讀取
```

### 正確格式

必須是 JSON object：

```json
{
  "ENV": "qa",
  "ROBOT_ID": "robot-01",
  "ACCOUNT": "test_user",
  "PASSWORD": "123456",
  "RETRY": 3,
  "DEBUG": true
}
```

單行也可以：

```json
{"ENV":"qa","ROBOT_ID":"robot-01","RETRY":3,"DEBUG":true}
```

錯誤格式：

```json
{ENV:"qa"}
```

原因：JSON key 必須用雙引號。

```json
{
  "ENV": "qa",
}
```

原因：JSON 最後一個欄位不能有尾逗號。

```text
ENV=qa
```

原因：這不是 JSON object。

### 變數命名建議

建議：

- 使用英文大寫、數字、底線。
- 例如 `ENV`、`ROBOT_ID`、`BASE_URL`、`ACCOUNT`、`PASSWORD`、`RETRY`。
- 不要覆蓋系統常用環境變數，例如 `PATH`、`HOME`、`USER`、`TEMP`。
- 敏感資料可以透過 JSON 傳入，但要注意 Airtest 腳本不要把密碼印到 log。

建議：

```json
{
  "BASE_URL": "https://qa.example.com",
  "DEVICE_GROUP": "factory-a"
}
```

不建議：

```json
{
  "base-url": "https://qa.example.com",
  "中文變數": "qa",
  "PATH": "custom"
}
```

### 在 Airtest 腳本讀取

`.air` 專案內的 Python 腳本可以用 `os.getenv()`：

```python
# -*- encoding=utf8 -*-
from airtest.core.api import *
import os

auto_setup(__file__)

env = os.getenv("ENV", "dev")
robot_id = os.getenv("ROBOT_ID", "unknown")
account = os.getenv("ACCOUNT", "")
password = os.getenv("PASSWORD", "")

print("ENV =", env)
print("ROBOT_ID =", robot_id)
```

`os.getenv("KEY", "default")` 的第二個參數是預設值。當 UI 沒有傳該變數時，Airtest 腳本會使用預設值。

### 數字與布林值

Agent 會把 JSON value 轉成字串放入環境變數，所以 Airtest 腳本要自行轉型。

UI 輸入：

```json
{
  "RETRY": 3,
  "DEBUG": true,
  "TIMEOUT": 15.5
}
```

Airtest 腳本：

```python
import os

retry = int(os.getenv("RETRY", "1"))
debug = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")
timeout = float(os.getenv("TIMEOUT", "10"))
```

### 常見範例

切換 QA / staging / production：

```json
{
  "ENV": "qa",
  "BASE_URL": "https://qa-api.example.com"
}
```

```python
import os

env = os.getenv("ENV", "dev")
base_url = os.getenv("BASE_URL", "https://dev-api.example.com")
print(f"Run on {env}: {base_url}")
```

登入帳密：

```json
{
  "ACCOUNT": "qa_user_01",
  "PASSWORD": "qa_password"
}
```

```python
import os
from airtest.core.api import *

account = os.getenv("ACCOUNT", "")
password = os.getenv("PASSWORD", "")

touch(Template("account_input.png"))
text(account)
touch(Template("password_input.png"))
text(password)
```

多機台使用不同參數：

Agent A：

```json
{
  "ROBOT_ID": "robot-a",
  "ENV": "qa"
}
```

Agent B：

```json
{
  "ROBOT_ID": "robot-b",
  "ENV": "qa"
}
```

```python
import os

robot_id = os.getenv("ROBOT_ID", "unknown")
print("Current robot:", robot_id)
```

## 資料保存

Server：

- `store.json` 保存 users、devices、missions、scripts metadata、audit。
- Docker 部署時，`/usr/src/app/data` 會掛載到主機 `SUPER_RESCUER_DATA_DIR`。
- Docker 部署時，上傳腳本實體檔放在 `/usr/src/app/scripts`，並掛載到主機 `SUPER_RESCUER_SCRIPTS_DIR`。
- Server 程式實際讀寫位置由 `SCRIPTS_DIR` 控制。

Agent：

- `AGENT_DATA` 控制工作目錄。
- 預設是 `/tmp/airtest_agent`。
- 下載腳本、解壓縮資料、stdout log、report zip 都會在這個工作目錄下產生。

## 目前限制

- 目前沒有 Pause。已實作的是 Stop，也就是停止目前 Airtest subprocess。
- 目前沒有排程佇列。每台 Agent 同時間只跑一個任務。
- 資料夾上傳會壓成 ZIP，不會在 Server 上保留原始目錄樹作為獨立資料夾。
- Uploaded Scripts 可以管理上傳項目，但目前沒有搜尋、分頁、標籤或版本管理。
- Stop 不會清理 Android 裝置上已經被測試腳本改變的狀態。
