# 部署手冊（中文）

本手冊說明 SuperRescuer 遠端控制系統的完整部署流程（建議使用 HTTPS）。

## 1) 架構概述

- 機器人端只安裝一個 Android App（SuperRescuer）。
- App 使用 MediaProjection + MediaCodec（H.264）將畫面主動推送到伺服器。
- 操作者透過 HTTPS/WS 連線至 Web 控制台。
- 控制指令由 WebSocket 下發，透過 AccessibilityService 執行。
- **WebSocket 穩定性**：前端心跳（15秒）、自動重連以及伺服器端 ping/pong（30秒）確保長期連線穩定。

## 2) 伺服器部署（Oracle / Ubuntu + Docker）

### 建置映像檔（從 repo 根目錄）

```bash
docker build -f server/Dockerfile -t rider-server .
```

### 啟動容器

```bash
docker run -d \
  --name rider-server \
  -p 3000:3000 \
  -e DEVICE_SHARED_KEY=nuwa8888 \
  -v /opt/rider/data:/usr/src/app/data \
  rider-server
```

### Docker Compose（HTTP 直連）

```bash
docker compose up -d --build
```

### 防火牆設定

- 開放 TCP `3000`，讓裝置與操作者可連線。
- `DEVICE_SHARED_KEY` 必須與 App 內建的 Shared Key 一致（預設 `nuwa8888`）。

## 3) 首次登入（Web 控制台）

- HTTPS 已設定：`https://<your-domain>`
- 未設定 HTTPS：`http://<oracle-host>:3000`
- 預設帳號：`admin` / `admin123`（請立即修改）

### 建立使用者（僅 admin）

- API：`POST /api/users`
- Body：`{ "username": "ops", "password": "***", "role": "operator" }`

完整 API 請參考 `docs/API.md`。

## 4) 機器人端 App 設定（SuperRescuer）

1. 安裝 Android App（`android/rider`）。
2. 開啟 App：
   - Server URL 預設為 `https://fleetmind.duckdns.org`
   - 若需修改 Server URL，**長按標題**顯示設定卡片後再存檔
3. 啟用 Accessibility 服務（供遠端控制使用）。
4. 授權相機與麥克風權限（App 會在開啟時提示）。
5. 授權螢幕擷取（MediaProjection）：
   - 點 **Grant Screen Permission** 只做授權，不會立即開始串流
   - 每次開機後需重新授權一次（系統限制，無法繞過）
6. 點 **Connect Server** 啟動前景服務並連 WebSocket。
7. 串流啟停由 Web 控制台按鈕觸發（App 不會自動開相機/麥克風/螢幕）。

### App UI 速覽

- 首頁顯示：連線狀態、服務狀態、權限狀態。
- Server 設定區預設隱藏，**長按標題**可顯示。
- 權限不足時提供對應按鈕（Camera/Mic/Accessibility/Screen）。

## 5) 控制台使用方式

### 即時串流與控制

- 點選設備卡片即可開始觀看。
- 點擊畫面為 Tap，拖曳為 Swipe。
- **Back/Home/Recents/Lock/Power Menu** 可直接下指令。
- **Power Menu**：相當於長按實體電源鍵（顯示關機/重啟選單）。
- 可在 **Screen** / **Camera** 切換畫面來源（支援 PiP/Split/Stack 模式）。
- **Mic** 可開啟麥克風聲音（音訊來源為裝置麥克風，非系統聲音）。
- **Start All** / **Stop All** 可遠端控制串流開關。
- Device Wall 只會顯示上線且有 model 的設備。

### 檔案瀏覽器

- 瀏覽裝置檔案系統（`/sdcard/`、`/storage/emulated/0/`、App 私有目錄）。
- 點擊資料夾導航，或直接輸入路徑。
- **下載**：單個檔案下載，或勾選多個檔案批次下載。
- **上傳**：從電腦上傳檔案至當前目錄。
- **刪除**：刪除檔案或資料夾（會顯示確認對話框）。
- 顯示檔案詳細資訊（大小、類型、修改時間）。
- 支援資料夾下載（自動在裝置端打包成 ZIP 後傳輸）。

### 裝置終端機

- 遠端執行 Shell 指令（非 Root，**受限於 App 沙箱權限**）。
- **推薦的非 Root 實用指令**：
  - **網路診斷**：
    - `ping -c 4 8.8.8.8`（測試連線與回應時間）
    - `ip addr`（查看 IP 位址）
    - `netstat -tun`（查看目前連線狀態）
    - `ip route`（檢查路由表）
  - **系統資訊**：
    - `cat /proc/meminfo`（記憶體總量與可用量 — *dumpsys 無權限*）
    - `cat /proc/cpuinfo`（CPU 詳細資訊）
    - `uptime`（系統啟動時間與負載）
    - `df -h`（儲存空間使用率）
    - `getprop ro.product.model`（裝置型號）
  - **應用程式**：
    - `pm list packages`（列出已安裝 App 包名）
    - `ps -A`（Android 7+ 受限：只能看到 Rider App 自己的執行緒）
  - **檔案瀏覽**：
    - `ls -l /sdcard/`（公開儲存區）
    - `ls -l /data/data/com.nuwarobotics.SuperRescuer/`（App 私有目錄）
- 即時顯示指令輸出。
- **注意**：需要較高權限的指令如 `reboot`、`su`、`dumpsys` 或 `input`（模擬按鍵）通常會失敗。模擬按鍵建議使用右側控制面板的按鈕。

### WebSocket 連線穩定性

- **前端自動心跳**：每 15 秒發送 ping，防止反向代理（Nginx/Cloudflare）因閒置而切斷連線。
- **自動重連**：連線中斷時自動重連，採用指數退避策略（最多重試 50 次）。
- **視覺化連線狀態**：右上角顯示連線狀態指示燈：
  - 🟢 綠色圓點 = 已連線
  - 🔴 紅色圓點 = 已斷線
  - 🟡 黃色閃爍圓點 = 重連中
- **重連橫幅**：連線中斷時，頁面頂部會顯示橘色提示橫幅。
- **伺服器端 ping/pong**：伺服器每 30 秒 ping 所有連線，偵測並清理殭屍連線。
- 重連成功後自動重新觀看當前選擇的裝置。

### 使用者管理與稽核

- Admin 使用者可進入 **User Management** 新增/編輯/刪除操作者帳號。
- **Audit Log** 請開啟：`https://<your-domain>/audit.html`（或 `http://<oracle-host>:3000/audit.html`）
- 所有控制動作與檔案操作都會記錄時間戳記與使用者資訊。

## 6) WebCodecs 與 HTTPS（推薦）

多數瀏覽器在非 localhost 的 HTTP 環境會封鎖 WebCodecs。若要讓所有人直接使用，必須使用 HTTPS。

- HTTP：WebCodecs/MediaDevices 需要 Chrome flag
- HTTPS：直接可用（Secure Context）

### 免費 HTTPS（DuckDNS + Caddy）

適用：Oracle Cloud VM / Ubuntu + Docker  
目的：所有使用者不需 Chrome flag，直接使用 WebCodecs / Web API

#### 架構總覽

Internet  
  → DuckDNS（DNS）  
  → Oracle 公網 IP  
  → Caddy（80 / 443，自動 HTTPS）  
  → 127.0.0.1:3000  
  → Docker rider-server

#### 1) DuckDNS 設定網域

前往 https://www.duckdns.org  
新增子網域並指向 Oracle VM 公網 IP。  

範例：  
`fleetmind.duckdns.org -> X.X.X.X`

#### 2) Oracle 放行 80 / 443

Oracle Cloud Console → VCN → Security List 或 NSG 新增：

| Port | Protocol | Source |
| --- | --- | --- |
| 80 | TCP | 0.0.0.0/0 |
| 443 | TCP | 0.0.0.0/0 |

VM 本機防火牆（Ubuntu）：
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

#### 3) 在 Oracle 主機安裝 Caddy（不是在容器內）

官方建議安裝方式：
```bash
sudo apt update
sudo apt install -y curl gnupg apt-transport-https

curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
| sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
| sudo tee /etc/apt/sources.list.d/caddy-stable.list

sudo apt update
sudo apt install -y caddy
```

#### 4) 設定 Caddy 反向代理

`/etc/caddy/Caddyfile`
```bash
sudo tee /etc/caddy/Caddyfile <<'EOF'
fleetmind.duckdns.org {
    reverse_proxy 127.0.0.1:3000
}
EOF

sudo systemctl reload caddy
```

#### 5) Docker 不可佔用 80/443（HTTPS 反向代理）

80/443 必須留給 Caddy。Docker 只綁 localhost：

`docker-compose.yml` 範例：
```yaml
services:
  rider-server:
    build:
      context: .
      dockerfile: server/Dockerfile
    container_name: rider-server
    ports:
      - "127.0.0.1:3000:3000"
    restart: unless-stopped
```

若不使用 HTTPS，改為：
```yaml
ports:
  - "3000:3000"
```

#### 6) 啟動順序

```bash
docker compose down
docker compose up -d --build
sudo systemctl enable --now caddy
```

#### 7) 驗證是否成功

```bash
systemctl status caddy
ss -ltnp | grep ':80 '
ss -ltnp | grep ':3000'
```

正確狀態：
- `:80` / `:443` → caddy
- `127.0.0.1:3000` → docker

#### 8) 使用方式

- Web：`https://fleetmind.duckdns.org`
- App Server URL：`https://fleetmind.duckdns.org`

HTTPS 生效後，WebCodecs 不再需要 Chrome flag。

#### 9) 常見錯誤與除錯

**Caddy 啟動失敗：bind: address already in use**  
原因：80/443 被其他服務佔用（Docker/Apache/Nginx）。  
解法：停止佔用者、並讓 Docker 只綁 `127.0.0.1:3000`。

**apt 出現 NO_PUBKEY**  
原因：沒用官方 repo。  
解法：重新照第 3 步安裝。

**HTTPS 沒生效**  
檢查：DNS 是否指向正確 IP、Oracle 安全組是否放行 80/443、VM 防火牆是否放行、Caddy 是否 running。

**為何開了規則還沒作用**
Linux VM 內的 iptables（預設存在且規則擋了流量）
1. 查看目前 iptables 入站規則
```bash
sudo iptables -L INPUT -n -v --line-numbers
```
2. 暫時允許入站測試（不改永久設定）
可以插規則測試：
```bash
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
```
3. 測試服務
```bash
curl -I http://<ip>
curl -I https://<ip>
```

## 7) 運維注意事項

- Session 在記憶體內，重啟伺服器會失效。
- Accessibility 控制可能受系統限制。
- 裝置重開機後需重新授權螢幕擷取（系統限制，除非設為 Device Owner）。
- 裝置開機會啟動前景服務並嘗試連線，但不會自動開相機/麥克風/螢幕。
- WebSocket 連線機制已優化，支援長期穩定運作（心跳、自動重連）。
- 伺服器會自動偵測並清理死連線（殭屍連線）透過 ping/pong 機制。

## 8) 疑難排解

- 裝置離線：檢查防火牆、IP、`DEVICE_SHARED_KEY`。
- 畫面黑屏：確認 WebCodecs 已允許或改用 localhost。
- 無法控制：確認 Accessibility 已啟用。
- 連線持續斷線：檢查反向代理的 timeout 設定（若使用 Nginx/Cloudflare，確保 WebSocket 支援已啟用）。
- 終端機指令執行失敗：確認裝置權限；大部分系統級指令需要 Root 權限。
