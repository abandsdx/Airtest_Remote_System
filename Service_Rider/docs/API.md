# API Overview

Base URL: `http://<oracle-host>:3000`

## Auth

- `POST /api/login` → `{ token, user }`
- Use `Authorization: Bearer <token>` for all protected calls.
- `GET /api/me`

## Users (admin)

- `GET /api/users`
- `POST /api/users` body: `{ username, password, role }`
- `PATCH /api/users/:id` body: `{ password?, role? }`

## Devices

- `GET /api/devices`
- Device fields include `streaming`, `camera`, `mic`.

## Missions

- `GET /api/missions`
- `POST /api/missions` body: `{ deviceId, payload }`
- `PATCH /api/missions/:id` body: `{ status?, deviceNote? }`

## Audits

- `GET /api/audits`

## Recordings

- `GET /api/recordings`
- `GET /api/recordings/:id/stream`
