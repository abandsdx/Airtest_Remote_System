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
  
  // 自動清理：啟動新任務時，將該設備舊的 'running' 任務標記為停止
  if (task.deviceId) {
    await query(
      `UPDATE task_runs SET status = 'stopped', ended_at = NOW(), updated_at = NOW() 
       WHERE device_id = $1 AND status = 'running' AND task_id <> $2`,
      [task.deviceId, task.task_id]
    ).catch(e => console.warn('[DB] Failed to cleanup old tasks:', e.message));
  }

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

  // 任務結束時，把 stdout tail (message) 裡的 [STAT] 行也存入 task_stats
  if (result.message && result.task_id) {
    const statLines = String(result.message).split(/\r?\n/);
    for (const line of statLines) {
      const parsed = parseStatLine(line);
      if (parsed) {
        await applyTaskStat(result.task_id, result.deviceId || null, parsed).catch(() => {});
      }
    }
  }
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
  // DEBUG: 確認 taskId 是否有值
  if (!taskId) {
    console.warn('[DB][STAT] recordStatLines called with no taskId! text snippet:', String(text || '').slice(0, 80));
    return;
  }
  if (!text) return;
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

function normalizeReportFilters(filters = {}) {
  return {
    from: filters.from || null,
    to: filters.to || null,
    deviceId: filters.deviceId || null,
    scriptName: filters.scriptName || null,
    status: filters.status || null,
    softwareVersion: filters.softwareVersion || null,
    agentId: filters.agentId || null,
    limit: Math.max(1, Math.min(Number(filters.limit) || 200, 1000)),
  };
}

function reportFilterWhereClause() {
  return `
    WHERE ($1::timestamptz IS NULL OR r.started_at >= $1::timestamptz)
      AND ($2::timestamptz IS NULL OR r.started_at < $2::timestamptz)
      AND ($3::text IS NULL OR r.device_id = $3)
      AND ($4::text IS NULL OR r.script_name = $4)
      AND ($5::text IS NULL OR r.status = $5)
      AND (
        $6::text IS NULL
        OR EXISTS (
          SELECT 1 FROM task_stats sv
          WHERE sv.task_id = r.task_id
            AND sv.stat_key = 'software_version'
            AND sv.stat_value = $6
        )
      )
      AND (
        $7::text IS NULL
        OR EXISTS (
          SELECT 1 FROM task_stats agent
          WHERE agent.task_id = r.task_id
            AND agent.stat_key = 'agent_id'
            AND agent.stat_value = $7
        )
      )
  `;
}

function reportFilterParams(filters) {
  const safeFilters = normalizeReportFilters(filters);
  return [
    safeFilters.from,
    safeFilters.to,
    safeFilters.deviceId,
    safeFilters.scriptName,
    safeFilters.status,
    safeFilters.softwareVersion,
    safeFilters.agentId,
  ];
}

async function listReportRuns(filters = {}) {
  const safeFilters = normalizeReportFilters(filters);
  const params = [...reportFilterParams(safeFilters), safeFilters.limit];
  const result = await query(
    `
      WITH filtered_runs AS (
        SELECT r.*
        FROM task_runs r
        ${reportFilterWhereClause()}
        ORDER BY r.started_at DESC
        LIMIT $8
      )
      SELECT
        fr.task_id,
        fr.device_id,
        fr.script_id,
        fr.script_name,
        fr.status,
        fr.started_at,
        fr.ended_at,
        fr.duration_ms,
        fr.message,
        fr.files,
        fr.created_at,
        fr.updated_at,
        COALESCE(
          jsonb_object_agg(
            s.stat_key,
            jsonb_build_object(
              'value',
              CASE
                WHEN s.stat_type = 'number' THEN to_jsonb(s.stat_number)
                ELSE to_jsonb(s.stat_value)
              END,
              'type',
              s.stat_type,
              'updatedAt',
              s.updated_at
            )
          ) FILTER (WHERE s.stat_key IS NOT NULL),
          '{}'::jsonb
        ) AS stats
      FROM filtered_runs fr
      LEFT JOIN task_stats s ON s.task_id = fr.task_id
      GROUP BY
        fr.task_id,
        fr.device_id,
        fr.script_id,
        fr.script_name,
        fr.status,
        fr.started_at,
        fr.ended_at,
        fr.duration_ms,
        fr.message,
        fr.files,
        fr.created_at,
        fr.updated_at
      ORDER BY fr.started_at DESC
    `,
    params
  );
  return result?.rows || [];
}

async function getReportSummary(filters = {}) {
  const result = await query(
    `
      WITH filtered_runs AS (
        SELECT r.*
        FROM task_runs r
        ${reportFilterWhereClause()}
      ),
      stat_pivot AS (
        SELECT
          fr.task_id,
          MAX(CASE WHEN s.stat_key = 'duration_seconds' THEN s.stat_number END) AS duration_seconds,
          MAX(CASE WHEN s.stat_key = 'round_started' THEN s.stat_number END) AS round_started,
          MAX(CASE WHEN s.stat_key = 'round_completed' THEN s.stat_number END) AS round_completed,
          MAX(CASE WHEN s.stat_key = 'tables_selected' THEN s.stat_number END) AS tables_selected,
          MAX(CASE WHEN s.stat_key = 'table_served' THEN s.stat_number END) AS table_served
        FROM filtered_runs fr
        LEFT JOIN task_stats s ON s.task_id = fr.task_id
        GROUP BY fr.task_id
      ),
      effective_runs AS (
        SELECT
          fr.*,
          sp.round_started,
          sp.round_completed,
          sp.tables_selected,
          sp.table_served,
          CASE
            WHEN fr.duration_ms IS NOT NULL THEN fr.duration_ms
            WHEN sp.duration_seconds IS NOT NULL THEN FLOOR(sp.duration_seconds * 1000)::INTEGER
            WHEN fr.status = 'running' THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - fr.started_at)) * 1000))::INTEGER
            ELSE 0
          END AS effective_duration_ms
        FROM filtered_runs fr
        LEFT JOIN stat_pivot sp ON sp.task_id = fr.task_id
      )
      SELECT
        COUNT(*)::INTEGER AS total_runs,
        COUNT(*) FILTER (WHERE status IN ('succeeded', 'success', 'passed'))::INTEGER AS succeeded_runs,
        COUNT(*) FILTER (WHERE status = 'running')::INTEGER AS running_runs,
        COUNT(*) FILTER (WHERE status = 'stopped')::INTEGER AS stopped_runs,
        COUNT(*) FILTER (
          WHERE status NOT IN ('succeeded', 'success', 'passed', 'running', 'stopped')
        )::INTEGER AS failed_runs,
        COALESCE(SUM(effective_duration_ms), 0)::BIGINT AS total_duration_ms,
        COALESCE(AVG(effective_duration_ms), 0)::DOUBLE PRECISION AS average_duration_ms,
        COALESCE(SUM(round_started), 0)::DOUBLE PRECISION AS total_round_started,
        COALESCE(SUM(round_completed), 0)::DOUBLE PRECISION AS total_round_completed,
        COALESCE(SUM(tables_selected), 0)::DOUBLE PRECISION AS total_tables_selected,
        COALESCE(SUM(table_served), 0)::DOUBLE PRECISION AS total_table_served
      FROM effective_runs
    `,
    reportFilterParams(filters)
  );
  return result?.rows?.[0] || {
    total_runs: 0,
    succeeded_runs: 0,
    running_runs: 0,
    stopped_runs: 0,
    failed_runs: 0,
    total_duration_ms: 0,
    average_duration_ms: 0,
    total_round_started: 0,
    total_round_completed: 0,
    total_tables_selected: 0,
    total_table_served: 0,
  };
}

async function getReportFilterOptions() {
  const [devices, agents, scripts, statuses, softwareVersions] = await Promise.all([
    query(`SELECT DISTINCT device_id AS value FROM task_runs WHERE device_id IS NOT NULL ORDER BY device_id ASC`),
    query(`
      SELECT DISTINCT stat_value AS value
      FROM task_stats
      WHERE stat_key = 'agent_id' AND stat_value IS NOT NULL
      ORDER BY stat_value ASC
    `),
    query(`SELECT DISTINCT script_name AS value FROM task_runs WHERE script_name IS NOT NULL ORDER BY script_name ASC`),
    query(`SELECT DISTINCT status AS value FROM task_runs WHERE status IS NOT NULL ORDER BY status ASC`),
    query(`
      SELECT DISTINCT stat_value AS value
      FROM task_stats
      WHERE stat_key = 'software_version' AND stat_value IS NOT NULL
      ORDER BY stat_value ASC
    `),
  ]);

  const values = (result) => result?.rows?.map((row) => row.value).filter(Boolean) || [];
  return {
    devices: values(devices),
    agents: values(agents),
    scripts: values(scripts),
    statuses: values(statuses),
    softwareVersions: values(softwareVersions),
  };
}

async function getRunningTaskId(deviceId) {
  if (!deviceId) return null;
  const result = await query(
    `SELECT task_id FROM task_runs WHERE device_id = $1 AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
    [deviceId]
  );
  return result?.rows?.[0]?.task_id || null;
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
  listReportRuns,
  getReportSummary,
  getReportFilterOptions,
  getRunningTaskId,
};
