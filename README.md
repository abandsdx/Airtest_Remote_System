# Airtest 遠端與 SuperRescuer 整合系統

這是一個整合了 **Android 即時監控與控制 (SuperRescuer/Service Rider)** 與 **Airtest 自動化腳本執行 (Pi Agent)** 的一體化遠端控制平台。

您可以透過統一個 Web 介面，不僅能肉眼監控遠端 Android 裝置的螢幕、相機，還能上傳並派發 Airtest (`.air`) 自動化腳本讓連接的 Pi Agent 自動執行操作，並將執行結果日誌與報告直接回傳至控制台。

---

## 🏗️ 系統架構

目前的架構已將所有的核心功能合併至一個統一的 Node.js WebSocket 伺服器中：

1. **Server (`Service_Rider/server`)**
   - 基於 Node.js 與 Express 建立。
   - 負責處理 WebSockets 連線（供 Web UI、Android App 與 Pi Agent 使用）。
   - 提供 RESTful API 處理使用者登入、檔案總管操作、腳本上傳及日誌管理。
   - 資料預設會儲存在 `Service_Rider/data`, `Service_Rider/scripts`, `Service_Rider/recordings` 內。

2. **Web UI (`Service_Rider/frontend`)**
   - 伺服器本身會自動託管該資料夾做為前端介面。
   - 包含即時畫面監控（Live View）、設備命令終端機（Terminal）、檔案總管（File Browser）以及全新的 **Airtest** 管理面板。
   - 在 Airtest 區塊中，可以上傳、選擇 `.air` 腳本，設定 JSON 執行變數，並可即時查看回傳的除錯日誌（Airtest Logs）。

3. **Pi Agent (`pi_agent/`)**
   - 基於 Python 打造的客戶端程式（可執行於 Raspberry Pi 或一般電腦）。
   - 透過設定檔與 `wss://` 連向伺服器並註冊成為一台可受控裝置 (`deviceId`)。
   - 內建 `airtest` 指令呼叫模組。當接收到伺服器的 `run_task` 指令時，會自動下載對應腳本、並使用設備連線 (ADB) 啟動測試，運行過程中的輸出會透過 WebSocket 逐行回傳至前端面板。

4. **Android App (`Service_Rider/android/rider`, 非必備)**
   - 針對需要直接硬體監控（如前鏡頭、桌面串流）的機器人端或手機。會直接將螢幕推流至 Server，並提供輔助存取 (Accessibility) 功能實作滑動、點擊指令。

---

## 🚀 快速啟動指南

### 1) 啟動主控制伺服器 (Server)

請確保您有安裝 `Node.js` (建議 18+)。

```bash
cd Service_Rider/server
npm install
npm start
```

伺服器預設會啟動於 `http://localhost:3000`。
首次登入預設帳號密碼為 `admin` / `admin123`（建議登入後盡快修改）。

### 2) 啟動 Pi Agent (自動化執行端)

請確保您的電腦或 Pi 已經安裝 Python 3.8+ 與 ADB 工具，且已有連結的 Android 設備 (`adb devices` 可看到)。

```bash
cd pi_agent
# 建立並啟動虛擬環境 (視作業系統而定)
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/Mac
source .venv/bin/activate

# 安裝所需套件 (包含 airtest)
pip install -r requirements.txt

# 啟動 Agent (預設會連線至 localhost:3000)
# 您可以修改 config.json 內的 server_host 與 agent_id
python main.py
```

> 若需要將 Agent 部署到遠端，請將 `pi_agent/config.json` 中的 `server_host` 修改為您的控制台公網位置 (例如 `https://fleetmind.duckdns.org`)。

---

## 🎮 使用方式 - Airtest 自動化流程

1. **上傳腳本**:
   在登入 Web UI 後，找到設備牆選中您的 Pi Agent 設備，接著在 **Airtest** 面板中，點擊 `Upload Script` 上傳寫好的 `.air` 資料夾壓縮檔（`.zip` 或直接封裝的 `.air` 檔）。
2. **選擇腳本**: 上傳完成後，下拉選單會自動刷新。選中您的腳本。
3. **設定變數** (可選): 在文字方塊中輸入 JSON 格式的變數（如 `{"foo": "bar"}`），會動態傳遞給 Agent 解析。
4. **執行與監控**:
   - 點擊 **Run Task**，前端會下發指令給 Agent。
   - 右下角的 **Airtest Logs** 面板會即時滾動顯示 Python Airtest 環境執行的每一行 `stdout` 畫面。
   - 執行完畢後會提示 `succeeded` 或 `failed`，並將帶有執行 HTML 報告的結果檔案傳回伺服器留存。

---

## 🛠️ Docker 部署 (推薦用於正式環境)

如果你要把伺服器放到 VPS (如 Oracle, EC2)，請參考 `Service_Rider/README.md`。內含完整 Docker 建立方式與建議結合 `Caddy` 做自動 HTTPS 的架構。

```bash
# 在專案根目錄或 Service_Rider 下執行：
docker-compose up -d --build
```
