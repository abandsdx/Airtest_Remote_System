export type AgentInfo = {
  id: string;
  online: boolean;
  last_seen: number;
  meta: Record<string, unknown>;
  queue_size: number;
  current_task?: string | null;
};

export type ScriptMeta = {
  id: string;
  filename: string;
  stored_name: string;
  created_at: number;
};

export type TaskRecord = {
  id: string;
  agent_id: string;
  script_id: string;
  variables: Record<string, unknown>;
  status: string;
  message: string;
  created_at: number;
  updated_at: number;
  artifacts: Record<string, string>;
};

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || window.location.origin;
export const WS_BASE =
  (import.meta.env.VITE_WS_BASE as string | undefined) || API_BASE.replace(/^http/, "ws");

function toUrl(path: string) {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}

export async function listAgents(): Promise<AgentInfo[]> {
  const res = await fetch(`${API_BASE}/api/agents`);
  if (!res.ok) throw new Error("Failed to load agents");
  return res.json();
}

export async function listScripts(): Promise<ScriptMeta[]> {
  const res = await fetch(`${API_BASE}/api/scripts`);
  if (!res.ok) throw new Error("Failed to load scripts");
  return res.json();
}

export async function uploadScript(file: File): Promise<ScriptMeta> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_BASE}/api/scripts/upload`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function enqueueTask(agentId: string, scriptId: string, variables: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script_id: scriptId, variables }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<TaskRecord>;
}

export function scriptDownloadUrl(scriptId: string) {
  return toUrl(`/api/scripts/${scriptId}`);
}
