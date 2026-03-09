# Device Setup (Single App)

This guide configures the robot device to stream and accept controls without ADB/VPN.

## 1) Install the App

- Build and install `android/rider` on the robot device.

## 2) Configure Server

- Open the app.
- Set **Server URL**: `http://<oracle-host>:3000`
- Set **Shared Key**: must match server `DEVICE_SHARED_KEY`.
- Tap **Save Config**.

## 3) Enable Accessibility

- Tap **Enable Accessibility Service**.
- Enable **Rider Remote Control Service**.

## 4) Start Streaming

- Tap **Start Streaming**.
- Grant the screen-capture permission.

## 5) Camera & Microphone

- Tap **Start Camera** to enable the front camera stream.
- Tap **Start Mic** to enable microphone audio.
- The app will prompt for camera/mic permissions if needed.
- Audio source is the device microphone.
- Use **Start All** / **Stop All** to toggle screen, camera, and mic together.

## Notes

- Streaming stays active via a foreground service.
- Closing the app does not stop streaming; use **Stop** buttons to end it.
- Screen capture permission is required after each reboot unless the app is device owner.
- Control actions are performed through Accessibility; some system actions may be limited.
