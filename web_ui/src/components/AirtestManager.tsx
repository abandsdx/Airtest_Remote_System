import { useEffect, useState } from "react";
import { ScriptMeta, enqueueTask, listScripts, uploadScript } from "../services/api";

type Props = {
  agentId: string | null;
  onLog: (msg: string) => void;
};

export function AirtestManager({ agentId, onLog }: Props) {
  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [variables, setVariables] = useState<string>("{}");
  const [busy, setBusy] = useState(false);

  const loadScripts = () => {
    listScripts()
      .then(setScripts)
      .catch((err) => onLog(`Load scripts failed: ${err}`));
  };

  useEffect(() => {
    loadScripts();
  }, []);

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    try {
      const meta = await uploadScript(fileList[0]);
      setScripts((cur) => [meta, ...cur]);
      setSelected(meta.id);
      onLog(`Uploaded script ${meta.filename}`);
    } catch (err) {
      onLog(`Upload failed: ${err}`);
    }
  };

  const runTask = async () => {
    if (!agentId || !selected) return;
    setBusy(true);
    try {
      const parsed = variables ? JSON.parse(variables) : {};
      const task = await enqueueTask(agentId, selected, parsed);
      onLog(`Queued task ${task.id}`);
    } catch (err) {
      onLog(`Queue failed: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3 className="title">Airtest Management</h3>
      <p className="muted">Upload .air files and run them on the selected agent.</p>
      <div className="controls">
        <input type="file" accept=".air" onChange={(e) => handleUpload(e.target.files)} />
      </div>
      <div className="controls">
        <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value || null)} style={{ minWidth: 220 }}>
          <option value="">Choose script</option>
          {scripts.map((script) => (
            <option key={script.id} value={script.id}>
              {script.filename}
            </option>
          ))}
        </select>
        <button className="primary" disabled={!agentId || !selected || busy} onClick={runTask}>
          Run on {agentId || "agent"}
        </button>
      </div>
      <textarea
        value={variables}
        onChange={(e) => setVariables(e.target.value)}
        rows={4}
        style={{ width: "100%", marginTop: 8, background: "#0f131b", color: "var(--text)", borderRadius: 10, padding: 10 }}
        placeholder='{"foo":"bar"}'
      />
    </div>
  );
}
