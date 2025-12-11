import { useEffect, useState } from "react";
import { AirtestManager } from "./components/AirtestManager";
import { AgentsDashboard } from "./components/AgentsDashboard";
import { DeviceControl } from "./components/DeviceControl";
import { LogsViewer } from "./components/LogsViewer";
import { AgentInfo, listAgents } from "./services/api";

export default function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) =>
    setLogs((cur) => [`${new Date().toLocaleTimeString()} ${msg}`, ...cur].slice(0, 200));

  useEffect(() => {
    const load = () =>
      listAgents()
        .then(setAgents)
        .catch((err) => addLog(`Load agents failed: ${err}`));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="app-shell">
      <h1 className="title">Airtest Remote Control</h1>
      <p className="muted">WebRTC streaming + Airtest queuing, all browser based.</p>
      <div className="grid two">
        <AgentsDashboard agents={agents} selected={selected} onSelect={setSelected} />
        <DeviceControl agentId={selected} onLog={addLog} />
      </div>
      <div className="grid two" style={{ marginTop: 12 }}>
        <AirtestManager agentId={selected} onLog={addLog} />
        <LogsViewer logs={logs} />
      </div>
    </div>
  );
}
