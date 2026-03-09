# Operator Console (No SSL)

Open the console in a browser:

```
http://<oracle-host>:3000
```

## Important

- WebCodecs requires a secure context. Without SSL, most browsers only allow it on `localhost`.
- If you must use plain HTTP on a remote host, enable Chrome flag:
  - `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
  - Add `http://<oracle-host>:3000`

## Login

- Default credentials: `admin` / `admin123`
- Change the password in `server/data/store.json` or reset the data file.
- Session tokens reset on server restart.

## Controls

- Click a device card to start viewing (only online devices are shown).
- Click on the video to tap, drag to swipe.
- Buttons: Back / Home / Recents / Lock.
- Use **Screen** / **Camera** buttons to switch stream source.
- Toggle **Audio** to listen to the microphone stream.
- Audio is captured from the device microphone (not system playback).
- Use **Start All** / **Stop All** to trigger device streams remotely.

## Audit Log

- Open the audit page: `http://<oracle-host>:3000/audit.html`
