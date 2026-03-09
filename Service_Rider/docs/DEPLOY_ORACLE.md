# Oracle Docker Deployment (No SSL)

This server is designed to run over plain HTTP/WS (no TLS). Use firewall rules to restrict access to trusted networks.

## Build

```bash
docker build -f server/Dockerfile -t rider-server .
```

## Run

```bash
docker run -d \
  --name rider-server \
  -p 3000:3000 \
  -e DEVICE_SHARED_KEY=change-me \
  -v /opt/rider/data:/usr/src/app/data \
  -v /opt/rider/recordings:/usr/src/app/recordings \
  rider-server
```

## Docker Compose

```bash
docker compose up -d --build
```

## Ports

- `3000/tcp` HTTP API + WebSocket

## Notes

- Default admin: `admin` / `admin123` (change immediately).
- Web console: `http://<oracle-host>:3000`
- Devices must use the same `DEVICE_SHARED_KEY` to connect.
- Session tokens reset on server restart.
- If you later add SSL, terminate TLS at a reverse proxy and keep the app on HTTP.
