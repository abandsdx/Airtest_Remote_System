type Props = {
  logs: string[];
};

export function LogsViewer({ logs }: Props) {
  return (
    <div className="panel">
      <h3 className="title">Logs</h3>
      <div className="log">
        {logs.length === 0 && <div className="muted">Waiting for messages...</div>}
        {logs.map((log, idx) => (
          <div key={idx}>{log}</div>
        ))}
      </div>
    </div>
  );
}
