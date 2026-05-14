#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${RIDER_HOST_PORT:=13000}"
: "${RIDER_BIND_ADDR:=0.0.0.0}"
: "${DEVICE_SHARED_KEY:=nuwa8888}"
: "${WS_FRAME_DEBUG:=1}"
: "${SUPER_RESCUER_DATA_DIR:=/opt/super-rescuer/data}"
: "${SUPER_RESCUER_RECORDINGS_DIR:=/opt/super-rescuer/recordings}"

export RIDER_HOST_PORT
export RIDER_BIND_ADDR
export DEVICE_SHARED_KEY
export WS_FRAME_DEBUG
export SUPER_RESCUER_DATA_DIR
export SUPER_RESCUER_RECORDINGS_DIR

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not in PATH."
  echo "Install Docker Engine and the Docker Compose plugin, then run this script again."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is not available."
  echo "Install docker compose v2, then run this script again."
  exit 1
fi

echo "Deploying SuperRescuer web server..."
echo "Host port: ${RIDER_HOST_PORT}"
echo "Bind address: ${RIDER_BIND_ADDR}"
echo "Data dir: ${SUPER_RESCUER_DATA_DIR}"
echo "Recordings dir: ${SUPER_RESCUER_RECORDINGS_DIR}"

docker compose up -d --build server

health_host="127.0.0.1"
if [ "$RIDER_BIND_ADDR" != "0.0.0.0" ] && [ "$RIDER_BIND_ADDR" != "::" ]; then
  health_host="$RIDER_BIND_ADDR"
fi

health_url="http://${health_host}:${RIDER_HOST_PORT}/api/health"
if command -v curl >/dev/null 2>&1; then
  echo "Waiting for health check: ${health_url}"
  healthy=0
  for _ in {1..20}; do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      echo "Health check passed."
      healthy=1
      break
    fi
    sleep 1
  done
  if [ "$healthy" -ne 1 ]; then
    echo "Health check did not pass yet. Check logs with: docker compose logs -f server"
  fi
fi

echo
echo "Web console: http://<server-ip>:${RIDER_HOST_PORT}"
echo "Local check: http://127.0.0.1:${RIDER_HOST_PORT}/api/health"
echo "Default admin: admin / admin123"
echo "Device shared key: ${DEVICE_SHARED_KEY}"
