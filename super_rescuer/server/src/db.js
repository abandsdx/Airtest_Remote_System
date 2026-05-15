const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const enabled = Boolean(databaseUrl);
const pool = enabled ? new Pool({ connectionString: databaseUrl }) : null;

let ready = false;

function parseStatLine(line) {
  const statIndex = String(line || '').indexOf('[STAT]');
  if (statIndex < 0) return null;

  const body = String(line).slice(statIndex + 6).trim();
  const assignMatch = body.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
  if (assignMatch) {
    return {
      key: assignMatch[1],
      op: 'set',
      value: assignMatch[2].trim(),
    };
  }

  const addMatch = body.match(/^([A-Za-z0-9_.-]+)\s*([+-])=?\s*(\d+(?:\.\d+)?)$/);
  if (addMatch) {
    return {
      key: addMatch[1],
      op: 'add',
      value: Number(addMatch[3]) * (addMatch[2] === '-' ? -1 : 1),
    };
  }

  return null;
}

async function query(text, params = []) {
  if (!pool || !ready) return null;
  return pool.query(text, params);
}

async function init() {
  if (!enabled) {
    console.log('[DB] DATABASE_URL is not set; task history persistence is disabled.');
    return false;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_runs (
      task_id TEXT PRIMARY KEY,
      device_id TEXT,
      script_id TEXT,
      script_name TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      duration_ms INTEGER,
      message TEXT,
      files JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_stats (
      id BIGSERIAL PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES task_runs(task_id) ON DELETE CASCADE,
      device_id TEXT,
      stat_key TEXT NOT NULL,
      stat_value TEXT,
      stat_number DOUBLE PRECISION,
      stat_type TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(task_id, stat_key)
    );
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_task_runs_started_at ON task_runs (started_at DESC);');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_task_stats_key ON task_stats (stat_key);');
  ready = true;
  console.log('[DB] Task history database is ready.');
  return true;
}

async function recordTaskStart(task) {
  if (!task?.task_id) return;
  await query(
    `
      INSERT INTO task_runs (task_id, device_id, script_id, script_name, status, started_at, updated_at)
      VALUES ($1, $2, $3, $4, 'running', NOW(), NOW())
      ON CONFLICT (task_id) DO UPDATE SET
        device_id = EXCLUDED.device_id,
        script_id = EXCLUDED.script_id,
        script_name = EXCLUDED.script_name,
        status = 'running',
        started_at = EXCLUDED.started_at,
        ended_at = NULL,
        duration_ms = NULL,
        message = NULL,
        files = NULL,
        updated_at = NOW()
    `,
    [task.task_id, task.deviceId || null, task.script_id || null, task.script_name || null]
  );
}

async function finishTaskRun(result) {
  if (!result?.task_id) return;
  const files = Array.isArray(result.files) ? result.files : null;
  await query(
    `
      INSERT INTO task_runs (task_id, device_id, status, started_at, ended_at, duration_ms, message, files, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW(), 0, $4, $5::jsonb, NOW())
      ON CONFLICT (task_id) DO UPDATE SET
        device_id = COALESCE(EXCLUDED.device_id, task_runs.device_id),
        status = EXCLUDED.status,
        ended_at = COALESCE(task_runs.ended_at, EXCLUDED.ended_at),
        duration_ms = COALESCE(
          task_runs.duration_ms,
          GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (EXCLUDED.ended_at - task_runs.started_at)) * 1000))::INTEGER
        ),
        message = COALESCE(EXCLUDED.message, task_runs.message),
        files = COALESCE(EXCLUDED.files, task_runs.files),
        updated_at = NOW()
    `,
    [
      result.task_id,
      result.deviceId || null,
      result.status || 'unknown',
      result.message || null,
      files ? JSON.stringify(files) : null,
    ]
  );
}

async function applyTaskStat(taskId, deviceId, parsed) {
  if (!taskId || !parsed?.key) return;

  // 確保 task_runs 記錄存在，避免腳本早期 [STAT] 因 FK 違反而靜默失敗
  // （race condition：task_runs INSERT 是非同步的，腳本可能比 DB 先跑到）
  await query(
    `INSERT INTO task_runs (task_id, device_id, status, started_at, updated_at)
     VALUES ($1, $2, 'running', NOW(), NOW())
     ON CONFLICT (task_id) DO NOTHING`,
    [taskId, deviceId || null]
  );

  if (parsed.op === 'add') {
    await query(
      `
        INSERT INTO task_stats (task_id, device_id, stat_key, stat_value, stat_number, stat_type, updated_at)
        VALUES ($1, $2, $3, NULL, $4, 'number', NOW())
        ON CONFLICT (task_id, stat_key) DO UPDATE SET
          device_id = COALESCE(EXCLUDED.device_id, task_stats.device_id),
          stat_value = NULL,
          stat_number = COALESCE(task_stats.stat_number, 0) + EXCLUDED.stat_number,
          stat_type = 'number',
          updated_at = NOW()
      `,
      [taskId, deviceId || null, parsed.key, parsed.value]
    );
    return;
  }

  await query(
    `
      INSERT INTO task_stats (task_id, device_id, stat_key, stat_value, stat_number, stat_type, updated_at)
      VALUES ($1, $2, $3, $4, NULL, 'text', NOW())
      ON CONFLICT (task_id, stat_key) DO UPDATE SET
        device_id = COALESCE(EXCLUDED.device_id, task_stats.device_id),
        stat_value = EXCLUDED.stat_value,
        stat_number = NULL,
        stat_type = 'text',
        updated_at = NOW()
    `,
    [taskId, deviceId || null, parsed.key, parsed.value]
  );
}

async function recordStatLines({ taskId, deviceId, text }) {
  if (!taskId || !text) return;
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseStatLine(line);
    if (parsed) {
      await applyTaskStat(taskId, deviceId, parsed);
    }
  }
}

async function listTaskRuns(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const result = await query(
    `
      SELECT task_id, device_id, script_id, script_name, status, started_at, ended_at,
             duration_ms, message, files, created_at, updated_at
      FROM task_runs
      ORDER BY started_at DESC
      LIMIT $1
    `,
    [safeLimit]
  );
  return result?.rows || [];
}

async function getTaskStats(taskId) {
  const result = await query(
    `
      SELECT task_id, device_id, stat_key, stat_value, stat_number, stat_type, updated_at
      FROM task_stats
      WHERE task_id = $1
      ORDER BY stat_key ASC
    `,
    [taskId]
  );
  return result?.rows || [];
}

function isReady() {
  return ready;
}

module.exports = {
  init,
  isReady,
  parseStatLine,
  recordTaskStart,
  finishTaskRun,
  recordStatLines,
  listTaskRuns,
  getTaskStats,
};
