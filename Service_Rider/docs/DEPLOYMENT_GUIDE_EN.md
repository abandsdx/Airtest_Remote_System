# Deployment Guide (English)

This guide covers the full deployment of the SuperRescuer Remote Control System (HTTPS recommended).

## 1) Architecture Overview

- Robot device runs a single Android app (SuperRescuer).
- App captures screen with MediaProjection + MediaCodec (H.264) and streams outbound to the server.
- Operator connects to the Web Console over HTTPS/WS.
- Control commands are delivered over WebSocket and executed by AccessibilityService.
- **WebSocket stability**: Frontend heartbeat (15s), auto-reconnect, and server-side ping/pong (30s) ensure long-term connection stability.

## 2) Server Deployment (Oracle / Ubuntu + Docker)

### Build Image (from repo root)

```bash
docker build -f server/Dockerfile -t rider-server .
```

### Run Container

```bash
docker run -d \
  --name rider-server \
  -p 3000:3000 \
  -e DEVICE_SHARED_KEY=nuwa8888 \
  -v /opt/rider/data:/usr/src/app/data \
  rider-server
```

### Docker Compose (HTTP direct)

```bash
docker compose up -d --build
```

### Open Firewall

- Allow inbound TCP `3000` from operator and device networks.
- `DEVICE_SHARED_KEY` must match the app's Shared Key (default `nuwa8888`).

## 3) First Login (Web Console)

- HTTPS configured: `https://<your-domain>`
- HTTP only: `http://<oracle-host>:3000`
- Default admin: `admin` / `admin123` (change immediately)

### Create Users (admin only)

- API: `POST /api/users`
- Body: `{ "username": "ops", "password": "***", "role": "operator" }`

See `docs/API.md` for full endpoints.

## 4) Device App Setup (SuperRescuer)

1. Install the Android app (`android/rider`).
2. Open the app:
   - Default Server URL: `https://fleetmind.duckdns.org`
   - To change Server URL, **long-press the title** to reveal the settings card.
3. Enable Accessibility service (required for remote control).
4. Grant camera and microphone permissions when prompted.
5. Grant screen capture (MediaProjection):
   - Tap **Grant Screen Permission** to authorize only (no streaming starts).
   - Screen permission must be granted after every reboot (system limitation).
6. Tap **Connect Server** to start the foreground service and WebSocket connection.
7. Streaming start/stop is controlled from the Web Console (app does not auto-start camera/mic/screen).

### App UI Overview

- Home shows: connection status, service status, permission status.
- Server settings are hidden by default; **long-press the title** to reveal.
- Permission shortcuts are available for Camera/Mic/Accessibility/Screen.

## 5) Operator Console Usage

### Live Stream \u0026 Control

- Select a device card to view live stream.
- Tap to click; drag to swipe on the video feed.
- Use **Back/Home/Recents/Lock/Power Menu** buttons for system actions.
- **Power Menu**: Equivalent to long-pressing the physical power button (shows power off/restart dialog).
- Switch between **Screen** and **Camera** feeds in the viewer (PiP/Split/Stack modes).
- Toggle **Mic** to listen to device microphone audio (not system playback).
- Use **Start All** / **Stop All** to remotely control all streams.
- Device wall only shows online devices with a model value.

### File Browser

- Browse device file system (`/sdcard/`, `/storage/emulated/0/`, app private directories).
- Navigate by clicking folders or entering paths directly.
- **Download** files individually or select multiple files for batch download.
- **Upload** files to the current directory from your computer.
- **Delete** files or folders (with confirmation dialog).
- View file metadata (size, type, modification time).
- Supports folder download (automatically zipped on device before transfer).

### Device Terminal

- Execute shell commands remotely on the device (non-root, **limited to app sandbox permissions**).
- **Recommended Commands (Non-Root)**:
  - **Network**: 
    - `ping -c 4 8.8.8.8` (Test connectivity)
    - `ip addr` (View IP address)
    - `netstat -tun` (View active connections)
    - `ip route` (Check routing table)
  - **System Info**: 
    - `cat /proc/meminfo` (Memory usage - *dumpsys is restricted*)
    - `cat /proc/cpuinfo` (CPU details)
    - `uptime` (System uptime & load average)
    - `df -h` (Storage usage)
    - `getprop ro.product.model` (Device model)
  - **App & Processes**: 
    - `pm list packages` (List installed apps)
    - `ps -A` (Restricted on Android 7+: only shows Rider app processes)
  - **Files**: 
    - `ls -l /sdcard/` (Public storage)
    - `ls -l /data/data/com.nuwarobotics.SuperRescuer/` (App private storage)
- Real-time output display.
- **Note**: System commands like `reboot`, `su`, `dumpsys`, or `input` (raw events) require Root/ADB shell privileges and will fail here.

### WebSocket Connection Stability

- **Frontend automatic heartbeat**: Sends ping every 15 seconds to prevent reverse proxy (Nginx/Cloudflare) timeout.
- **Auto-reconnect**: Automatically reconnects on disconnection with exponential backoff (up to 50 attempts).
- **Visual status indicator**: Connection status displayed in top-right corner:
  - 🟢 Green dot = Connected
  - 🔴 Red dot = Disconnected
  - 🟡 Yellow blinking dot = Reconnecting
- **Reconnection banner**: Orange banner appears at top when connection is lost.
- **Server-side ping/pong**: Server pings all connections every 30 seconds to detect and cleanup zombie connections.
- Re-watches current device automatically after successful reconnection.

### User Management \u0026 Audit

- Admin users can access **User Management** to create/edit/delete operator accounts.
- **Audit Log** is available at `https://<your-domain>/audit.html` (or `http://<oracle-host>:3000/audit.html`).
- All control actions and file operations are logged with timestamps and user information.

## 6) WebCodecs \u0026 HTTPS (Recommended)

Most browsers block WebCodecs on HTTP (non-localhost). If you want everyone to use the Web Console without Chrome flags, use HTTPS.

- HTTP: WebCodecs/MediaDevices need a Chrome flag
- HTTPS: works out of the box (Secure Context)

### Free HTTPS (DuckDNS + Caddy)

Applies to: Oracle Cloud VM / Ubuntu + Docker  
Goal: no Chrome flags, WebCodecs works for all users.

#### Topology

Internet  
  -> DuckDNS (DNS)  
  -> Oracle public IP  
  -> Caddy (80/443, automatic HTTPS)  
  -> 127.0.0.1:3000  
  -> Docker rider-server

#### 1) DuckDNS domain

Go to https://www.duckdns.org  
Create a subdomain and point it to your Oracle public IP.

Example:  
`fleetmind.duckdns.org -> X.X.X.X`

#### 2) Open 80/443 on Oracle

Oracle Cloud Console -> VCN -> Security List/NSG:

| Port | Protocol | Source |
| --- | --- | --- |
| 80 | TCP | 0.0.0.0/0 |
| 443 | TCP | 0.0.0.0/0 |

VM firewall (Ubuntu):
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

#### 3) Install Caddy on the VM (not inside Docker)

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

#### 4) Configure reverse proxy

`/etc/caddy/Caddyfile`
```bash
sudo tee /etc/caddy/Caddyfile <<'EOF'
fleetmind.duckdns.org {
    reverse_proxy 127.0.0.1:3000
}
EOF

sudo systemctl reload caddy
```

#### 5) Docker must NOT bind 80/443

For HTTPS, bind only localhost:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

If you do not use HTTPS, use:
```yaml
ports:
  - "3000:3000"
```

#### 6) Start order

```bash
docker compose down
docker compose up -d --build
sudo systemctl enable --now caddy
```

#### 7) Verify

```bash
systemctl status caddy
ss -ltnp | grep ':80 '
ss -ltnp | grep ':3000'
```

Expected:
- `:80` / `:443` -> caddy
- `127.0.0.1:3000` -> docker

#### 8) Use

- Web: `https://fleetmind.duckdns.org`
- App Server URL: `https://fleetmind.duckdns.org`

HTTPS removes the need for Chrome flags.

#### 9) Common errors

**Caddy fails: bind: address already in use**  
Cause: port 80/443 is used by Docker/Apache/Nginx.  
Fix: stop the conflicting service and bind Docker to `127.0.0.1:3000`.

**apt NO_PUBKEY**  
Cause: not using the official repo.  
Fix: re-run the install steps in section 3.

**HTTPS not working**  
Check: DNS points to correct IP, 80/443 open, VM firewall open, Caddy running.

## 7) Operational Notes

- Sessions are in-memory. Server restart invalidates all tokens.
- Accessibility control may be limited for some system actions.
- MediaProjection permission must be granted after reboot unless the app is device owner.
- After reboot the device starts a foreground service and connects, but it does not auto-start camera/mic/screen streaming.
- WebSocket connections are stable for long-term operation thanks to heartbeat and auto-reconnect mechanisms.
- Server automatically detects and cleans up dead connections (zombie connections) via ping/pong.

## 8) Troubleshooting

- Device shows offline: check firewall and `DEVICE_SHARED_KEY`.
- Console shows black screen: ensure WebCodecs allowed or use localhost.
- No control response: verify Accessibility service is enabled.
- Connection keeps dropping: check reverse proxy timeout settings (if using Nginx/Cloudflare, ensure WebSocket support is enabled).
- Terminal commands fail: verify device permissions; most system-level commands require root access.
