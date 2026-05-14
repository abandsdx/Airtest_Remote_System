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

## 任務 JSON 變數用法

Web Console 的 Airtest 區塊有一個變數輸入欄，placeholder 類似：

```json
{"var": "val"}
```

這個欄位用來為「單次任務」傳入參數。前端會把它放進 `run_task.vars`，Agent 收到後會在執行 `airtest run` 前，把每個 key/value 寫進該次 Airtest subprocess 的環境變數。

資料流如下：

```text
Web Console JSON input
  -> run_task.vars
  -> Airtest Agent
  -> subprocess env
  -> airtest run <script>
  -> Airtest Python script uses os.getenv(...)
```

這些變數只存在於該次 `airtest run` 程序，不會永久寫入 Agent 主機的系統環境變數，也不會自動儲存到 Server。

### UI 輸入格式

必須輸入合法 JSON object。可以空白；空白代表不傳任何變數。

基本範例：

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

一行格式也可以：

```json
{"ENV":"qa","ROBOT_ID":"robot-01","RETRY":3,"DEBUG":true}
```

不合法範例：

```json
{ENV:"qa"}
```

原因：JSON key 必須使用雙引號。

```json
{
  "ENV": "qa",
}
```

原因：JSON 最後一個欄位後面不能有逗號。

```text
ENV=qa
```

原因：這不是 JSON object。

### 變數命名建議

建議使用環境變數慣例：

- 使用大寫英文字母、數字、底線。
- 例如 `ENV`、`ROBOT_ID`、`BASE_URL`、`RETRY`。
- 不建議使用空白、減號、中文或特殊符號。
- 不建議使用系統常見保留名稱，例如 `PATH`、`HOME`、`USER`、`TEMP`，避免覆蓋 subprocess 原本環境。

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
  "測試環境": "qa",
  "PATH": "custom"
}
```

### Airtest 腳本讀取方式

在 `.air` 腳本的 Python 程式中使用 `os.getenv()` 讀取。

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

`os.getenv("KEY", "default")` 的第二個參數是預設值。當 UI 沒有傳該變數時，腳本會使用預設值。

### 型別轉換

Agent 會把 JSON 的 value 轉成字串後放進環境變數。因此 Airtest 腳本讀到的值都是 string。

例如 UI 輸入：

```json
{
  "RETRY": 3,
  "DEBUG": true,
  "TIMEOUT": 15.5
}
```

Airtest 腳本中：

```python
import os

retry = int(os.getenv("RETRY", "1"))
debug = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")
timeout = float(os.getenv("TIMEOUT", "10"))
```

注意布林值在 Python 中可能會變成 `"True"` / `"False"`，所以建議使用 `.lower()` 後再判斷。

### 傳入測試環境

UI：

```json
{
  "ENV": "qa",
  "BASE_URL": "https://qa-api.example.com"
}
```

Airtest：

```python
import os

env = os.getenv("ENV", "dev")
base_url = os.getenv("BASE_URL", "https://dev-api.example.com")

print(f"Run on {env}: {base_url}")
```

### 傳入帳號密碼

UI：

```json
{
  "ACCOUNT": "qa_user_01",
  "PASSWORD": "qa_password"
}
```

Airtest：

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

注意：目前系統沒有加密儲存任務變數，也可能出現在瀏覽器、Server/Agent 記憶體或 log 中。正式密碼、token、API key 不建議直接放在 UI 變數欄，除非部署環境已受控且你接受這個風險。

### 傳入不同機台參數

多台 Agent 同時執行時，每次 Run Task 都可以輸入不同 JSON。變數只會傳給該次任務，不會影響其他機台。

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

Airtest：

```python
import os

robot_id = os.getenv("ROBOT_ID", "unknown")
print("Current robot:", robot_id)
```

### 傳入複雜設定

環境變數本質上是字串。若要傳入多層設定，不建議直接放 JSON object：

```json
{
  "CONFIG": {
    "base_url": "https://qa.example.com",
    "timeout": 30
  }
}
```

目前程式會把 value 用 Python `str(value)` 轉成字串，巢狀 object 會變成類似 `"{'base_url': 'https://qa.example.com', 'timeout': 30}"`，這不是標準 JSON 字串。

建議改成傳 JSON 字串：

```json
{
  "CONFIG_JSON": "{\"base_url\":\"https://qa.example.com\",\"timeout\":30}"
}
```

Airtest：

```python
import json
import os

config = json.loads(os.getenv("CONFIG_JSON", "{}"))
base_url = config.get("base_url", "https://dev.example.com")
timeout = int(config.get("timeout", 10))
```

如果設定很多，也可以把設定檔放在腳本包內，UI 只傳選擇哪個設定檔：

UI：

```json
{
  "CONFIG_NAME": "qa"
}
```

Airtest：

```python
import json
import os
from pathlib import Path

config_name = os.getenv("CONFIG_NAME", "dev")
config_path = Path(__file__).parent / "configs" / f"{config_name}.json"
config = json.loads(config_path.read_text(encoding="utf-8"))
```

### 預設值與必填檢查

建議在 Airtest 腳本集中處理設定，避免變數缺漏時任務跑到一半才失敗。

```python
import os

def required_env(name):
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value

ENV = os.getenv("ENV", "dev")
ACCOUNT = required_env("ACCOUNT")
PASSWORD = required_env("PASSWORD")
RETRY = int(os.getenv("RETRY", "1"))
```

### 常見錯誤

| 問題 | 原因 | 解法 |
| --- | --- | --- |
| UI 提示 `Variables must be valid JSON` | JSON 格式錯誤 | 使用雙引號、移除尾端逗號、確認最外層是 object |
| 腳本讀不到變數 | key 名稱不一致 | UI 的 `ENV` 必須對應腳本的 `os.getenv("ENV")` |
| 數字比較怪怪的 | `os.getenv()` 讀到的是字串 | 使用 `int()` / `float()` 轉型 |
| 布林判斷錯誤 | `"False"` 字串在 Python if 中仍為 truthy | 用 `.lower() in ("true", "1", "yes")` |
| 複雜 JSON 解析失敗 | 巢狀 object 被轉成 Python 字串格式 | 傳 JSON 字串，腳本用 `json.loads()` |
| 密碼出現在 log | 腳本或系統印出了環境變數 | 不要 print 敏感值，正式密碼不要直接放 UI 變數欄 |

### 建議的腳本模板

```python
# -*- encoding=utf8 -*-
from airtest.core.api import *
import json
import os

auto_setup(__file__)

def getenv_bool(name, default=False):
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.lower() in ("true", "1", "yes", "y")

def getenv_int(name, default):
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return int(raw)

ENV = os.getenv("ENV", "dev")
ROBOT_ID = os.getenv("ROBOT_ID", "unknown")
RETRY = getenv_int("RETRY", 1)
DEBUG = getenv_bool("DEBUG", False)
CONFIG = json.loads(os.getenv("CONFIG_JSON", "{}"))

print("ENV =", ENV)
print("ROBOT_ID =", ROBOT_ID)
print("RETRY =", RETRY)
print("DEBUG =", DEBUG)

for attempt in range(RETRY):
    print(f"Attempt {attempt + 1}/{RETRY}")
    # Airtest steps here
```

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
