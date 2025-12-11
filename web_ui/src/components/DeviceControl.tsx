import { useEffect, useRef, useState } from "react";
import { WS_BASE } from "../services/api";
import { SignalingClient } from "../services/signaling";

type Props = {
  agentId: string | null;
  onLog: (msg: string) => void;
};

export function DeviceControl({ agentId, onLog }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [client, setClient] = useState<SignalingClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [tapCoords, setTapCoords] = useState({ x: 100, y: 200 });
  const [text, setText] = useState("");

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      client?.disconnect();
    };
  }, [client]);

  useEffect(() => {
    // switching agents tears down the previous connection
    client?.disconnect();
    setConnected(false);
    setStream(null);
  }, [agentId]);

  const connect = () => {
    if (!agentId) return;
    const nextClient = new SignalingClient({
      agentId,
      wsBase: WS_BASE,
      events: {
        onLog,
        onTrack: (s) => setStream(s),
      },
    });
    setClient(nextClient);
    nextClient.connect();
    setConnected(true);
  };

  const disconnect = () => {
    client?.disconnect();
    setConnected(false);
  };

  const sendTap = () => client?.sendControl("tap", tapCoords);
  const sendText = () => {
    client?.sendControl("text", { text });
    setText("");
  };

  const sendKey = (key: string) => client?.sendControl("key", { key });

  return (
    <div className="panel">
      <h3 className="title">Device Control</h3>
      <div className="video-shell">
        <video ref={videoRef} autoPlay playsInline />
      </div>
      <div className="controls">
        <button className="primary" onClick={connect} disabled={!agentId || connected}>
          Connect
        </button>
        <button onClick={disconnect} disabled={!connected}>
          Disconnect
        </button>
        <button onClick={() => sendKey("KEYCODE_HOME")} disabled={!connected}>
          Home
        </button>
        <button onClick={() => sendKey("KEYCODE_BACK")} disabled={!connected}>
          Back
        </button>
      </div>
      <div className="controls">
        <input
          type="number"
          value={tapCoords.x}
          onChange={(e) => setTapCoords({ ...tapCoords, x: Number(e.target.value) })}
          style={{ width: 90 }}
        />
        <input
          type="number"
          value={tapCoords.y}
          onChange={(e) => setTapCoords({ ...tapCoords, y: Number(e.target.value) })}
          style={{ width: 90 }}
        />
        <button onClick={sendTap} disabled={!connected}>
          Tap
        </button>
      </div>
      <div className="controls">
        <input
          placeholder="Send text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button onClick={sendText} disabled={!connected || !text}>
          Send
        </button>
      </div>
      {!agentId && <p className="muted">Select an agent to connect.</p>}
    </div>
  );
}
