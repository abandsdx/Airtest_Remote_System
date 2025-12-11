import { AgentInfo } from "../services/api";

type Props = {
  agents: AgentInfo[];
  selected?: string | null;
  onSelect: (id: string) => void;
};

export function AgentsDashboard({ agents, selected, onSelect }: Props) {
  return (
    <div className="panel">
      <h3 className="title">Agents</h3>
      <p className="muted">Pick a Pi agent to start streaming and sending tasks.</p>
      <div className="agents-list">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="agent-card"
            style={{
              borderColor: selected === agent.id ? "#50e3c2" : undefined,
              boxShadow: selected === agent.id ? "0 0 0 1px #50e3c2" : undefined,
            }}
            onClick={() => onSelect(agent.id)}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{agent.id}</div>
              <div className="muted">
                {agent.online ? "online" : "offline"} · queue {agent.queue_size}
              </div>
            </div>
            <span className="badge">{agent.online ? "ONLINE" : "OFFLINE"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
