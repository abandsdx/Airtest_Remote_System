const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const JSZip = require('jszip');

const store = require('./store');

const port = Number(process.env.PORT || 3000);
const deviceSharedKey = process.env.DEVICE_SHARED_KEY || 'rider-dev-key';
const scriptsDir = process.env.SCRIPTS_DIR
  ? path.resolve(process.env.SCRIPTS_DIR)
  : path.join(__dirname, '..', 'scripts');
const frontendCandidates = [
  path.join(__dirname, '..', '..', 'frontend'),
  path.join(__dirname, '..', 'frontend'),
];
const frontendDir = frontendCandidates.find((candidate) => fs.existsSync(candidate));

const sessions = new Map();
const sessionTtlMs = 2 * 60 * 60 * 1000; // 縮短為 2 小時,提高安全性
const sessionCleanupMs = 5 * 60 * 1000;

// 速率限制: 追蹤 IP 的請求次數
const rateLimitMap = new Map(); // IP -> { count, resetAt }
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 分鐘
const RATE_LIMIT_MAX_REQUESTS = 100; // 每分鐘最多 100 次請求
const LOGIN_RATE_LIMIT_MAX = 50; // 下調限制,但保留防護 (原為 5,太嚴格了)

fs.mkdirSync(scriptsDir, { recursive: true });
const directoryUploadTempDir = path.join(scriptsDir, '.tmp-directory-uploads');
fs.mkdirSync(directoryUploadTempDir, { recursive: true });

// Setup multer for script upload
const scriptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, scriptsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const uploadScripts = multer({ storage: scriptStorage });
const uploadDirectory = multer({ dest: directoryUploadTempDir });

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of sessions.entries()) {
    if (entry.expiresAt < now) {
      sessions.delete(token);
    }
  }
}, sessionCleanupMs);

const app = express();

// 速率限制中間件
function rateLimitMiddleware(maxRequests = RATE_LIMIT_MAX_REQUESTS) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    let entry = rateLimitMap.get(ip);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      rateLimitMap.set(ip, entry);
    }

    entry.count++;

    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'too_many_requests' });
    }

    return next();
  };
}

// 清理過期的速率限制記錄
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (entry.resetAt < now) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

app.use((req, res, next) => {
  // 改進 CORS 設定 - 只在開發環境允許所有來源
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['*'];

  const origin = req.headers.origin;
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }

  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 小時

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

app.use(express.json({ limit: '10mb' }));
app.use(rateLimitMiddleware()); // 應用全局速率限制
if (frontendDir) {
  app.use('/', express.static(frontendDir));
}

function createSession(user) {
  const token = crypto.randomUUID();
  sessions.set(token, {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
    expiresAt: Date.now() + sessionTtlMs,
  });
  return token;
}

function verifySession(token) {
  if (!token) {
    return null;
  }
  const entry = sessions.get(token);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return entry.user;
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const user = verifySession(token);
  if (!user) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  req.user = user;
  return next();
}

function deviceOrUserAuthRequired(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const user = verifySession(sessionToken);
  if (user) {
    req.user = user;
    return next();
  }

  const deviceKey = req.headers['x-device-key'];
  if (typeof deviceKey === 'string' && deviceKey === deviceSharedKey) {
    req.deviceAuth = true;
    return next();
  }

  return res.status(401).json({ error: 'unauthorized' });
}

function roleRequired(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    return next();
  };
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/login', rateLimitMiddleware(LOGIN_RATE_LIMIT_MAX), (req, res) => {
  const { username, password } = req.body || {};

  // 輸入驗證
  if (!username || !password) {
    return res.status(400).json({ error: 'missing_credentials' });
  }

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'invalid_input_type' });
  }

  if (username.length > 100 || password.length > 100) {
    return res.status(400).json({ error: 'input_too_long' });
  }

  const user = store.findUser(username);
  if (!user) {
    // 使用相同的錯誤訊息,避免洩漏用戶是否存在
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const passwordHash = store.hashPassword(password);
  if (user.passwordHash !== passwordHash) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  store.addAudit({
    id: crypto.randomUUID(),
    ts: Date.now(),
    actor: user.username,
    action: 'login',
    deviceId: null,
    meta: req.ip,
  });

  return res.json({
    token: createSession(user),
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  });
});

app.get('/api/devices', authRequired, (req, res) => {
  res.json({ devices: store.data.devices });
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/users', authRequired, roleRequired(['admin']), (req, res) => {
  const users = store.data.users.map((user) => ({
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }));
  res.json({ users });
});

app.post('/api/users', authRequired, roleRequired(['admin']), (req, res) => {
  const { username, password, role } = req.body || {};

  // 輸入驗證
  if (!username || !password) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'invalid_input_type' });
  }

  if (username.length < 3 || username.length > 50) {
    return res.status(400).json({ error: 'username_length_invalid' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'password_too_short' });
  }

  if (role && !['admin', 'operator'].includes(role)) {
    return res.status(400).json({ error: 'invalid_role' });
  }

  if (store.findUser(username)) {
    return res.status(409).json({ error: 'username_exists' });
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash: store.hashPassword(password),
    role: role || 'operator',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.data.users.push(user);
  store.save();

  store.addAudit({
    id: crypto.randomUUID(),
    ts: Date.now(),
    actor: req.user.username,
    action: 'user-create',
    deviceId: null,
    meta: username,
  });

  return res.status(201).json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

app.patch('/api/users/:id', authRequired, roleRequired(['admin']), (req, res) => {
  const { password, role } = req.body || {};
  const user = store.data.users.find((item) => item.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (password) {
    user.passwordHash = store.hashPassword(password);
  }
  if (role) {
    user.role = role;
  }
  user.updatedAt = Date.now();
  store.save();

  store.addAudit({
    id: crypto.randomUUID(),
    ts: Date.now(),
    actor: req.user.username,
    action: 'user-update',
    deviceId: null,
    meta: user.username,
  });

  return res.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

app.delete('/api/users/:id', authRequired, roleRequired(['admin']), (req, res) => {
  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: 'cannot_delete_self' });
  }

  const user = store.data.users.find((item) => item.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'not_found' });
  }

  const success = store.deleteUser(req.params.id);
  if (!success) {
    return res.status(500).json({ error: 'delete_failed' });
  }

  store.addAudit({
    id: crypto.randomUUID(),
    ts: Date.now(),
    actor: req.user.username,
    action: 'user-delete',
    deviceId: null,
    meta: user.username,
  });

  return res.json({ status: 'ok' });
});

app.get('/api/missions', authRequired, (req, res) => {
  res.json({ missions: store.data.missions });
});

app.post('/api/missions', authRequired, (req, res) => {
  const { deviceId, payload } = req.body || {};

  // 輸入驗證
  if (!deviceId) {
    return res.status(400).json({ error: 'device_required' });
  }

  if (typeof deviceId !== 'string') {
    return res.status(400).json({ error: 'invalid_device_id' });
  }

  if (payload && typeof payload !== 'object') {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const mission = {
    id: crypto.randomUUID(),
    deviceId,
    payload: payload || {},
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.addMission(mission);

  broadcastToOperators({ type: 'mission', mission });
  sendToDevice(deviceId, JSON.stringify({ type: 'mission', mission }));

  return res.status(201).json({ mission });
});

app.patch('/api/missions/:id', authRequired, (req, res) => {
  const mission = store.updateMission(req.params.id, req.body || {});
  if (!mission) {
    return res.status(404).json({ error: 'not_found' });
  }
  broadcastToOperators({ type: 'mission-update', mission });
  return res.json({ mission });
});

app.get('/api/audits', authRequired, (req, res) => {
  res.json({ audits: store.data.audits.slice(-500) });
});

function serializeScript(script) {
  let size = script.size;
  let fileExists = false;
  if (script.path && fs.existsSync(script.path)) {
    fileExists = true;
    if (typeof size !== 'number') {
      size = fs.statSync(script.path).size;
    }
  }

  return {
    id: script.id,
    filename: script.filename,
    stored_name: script.stored_name,
    size: typeof size === 'number' ? size : null,
    fileExists,
    uploadedBy: script.uploadedBy || null,
    uploadType: script.uploadType || 'file',
    fileCount: typeof script.fileCount === 'number' ? script.fileCount : null,
    originalDirectoryName: script.originalDirectoryName || null,
    originalSize: typeof script.originalSize === 'number' ? script.originalSize : null,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
  };
}

function safeDisplayName(value, fallback) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const lastPart = raw.replace(/\\/g, '/').split('/').filter(Boolean).pop() || fallback;
  const cleaned = lastPart.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function normalizeUploadRelativePath(value) {
  if (typeof value !== 'string') {
    throw new Error('invalid_relative_path');
  }

  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('invalid_relative_path');
  }

  const parts = normalized.split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.some((part) => part === '..' || part.includes('\0'))) {
    throw new Error('invalid_relative_path');
  }

  return parts.join('/');
}

function cleanupUploadedTempFiles(files) {
  (files || []).forEach((file) => {
    if (!file.path) return;
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (err) {
      console.warn(`Failed to remove temp upload ${file.path}:`, err.message);
    }
  });
}

app.get('/api/scripts', authRequired, (req, res) => {
  const scripts = (store.data.scripts || []).map(serializeScript);
  res.json({ scripts });
});

app.post('/api/scripts/upload', authRequired, uploadScripts.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const originalNameLower = req.file.originalname.toLowerCase();
  if (originalNameLower.endsWith('.air')) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      error: 'A .air project is a directory. Use Upload Folder for .air projects, or upload a .zip that contains the .air directory.'
    });
  }
  if (!originalNameLower.endsWith('.zip')) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Only .zip files are accepted. Use Upload Folder for .air project directories.' });
  }

  const script = {
    id: crypto.randomUUID(),
    filename: req.file.originalname,
    stored_name: req.file.filename,
    path: req.file.path,
    size: req.file.size,
    uploadedBy: req.user.username,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  store.addScript(script);
  store.addAudit({
    id: crypto.randomUUID(),
    ts: Date.now(),
    actor: req.user.username,
    action: 'script-upload',
    deviceId: null,
    meta: req.file.originalname,
  });

  return res.json({ script: serializeScript(script) });
});

app.post('/api/scripts/upload-directory', authRequired, uploadDirectory.array('files'), async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  let destinationPath = null;
  let persisted = false;

  try {
    if (!files.length) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    let relativePaths;
    try {
      relativePaths = JSON.parse(req.body.relativePathsJson || '[]');
    } catch (err) {
      return res.status(400).json({ error: 'Invalid relative path metadata' });
    }

    if (!Array.isArray(relativePaths) || relativePaths.length !== files.length) {
      return res.status(400).json({ error: 'Relative path metadata does not match uploaded files' });
    }

    const seenPaths = new Set();
    const normalizedPaths = relativePaths.map((relativePath) => {
      const normalizedPath = normalizeUploadRelativePath(relativePath);
      const key = normalizedPath.toLowerCase();
      if (seenPaths.has(key)) {
        throw new Error('duplicate_relative_path');
      }
      seenPaths.add(key);
      return normalizedPath;
    });

    const firstRoot = normalizedPaths[0].split('/')[0];
    const safeRootName = safeDisplayName(req.body.rootName || firstRoot, 'airtest-directory');
    const rawZipBaseName = safeRootName.toLowerCase().endsWith('.zip')
      ? safeRootName.slice(0, -4)
      : safeRootName;
    const zipBaseName = rawZipBaseName || 'airtest-directory';
    const displayFilename = `${zipBaseName}.zip`;
    const storedName = `${Date.now()}-${crypto.randomUUID()}-${zipBaseName}.zip`;
    destinationPath = path.join(scriptsDir, storedName);

    const zip = new JSZip();
    let originalSize = 0;
    files.forEach((file, index) => {
      originalSize += file.size || 0;
      zip.file(normalizedPaths[index], fs.readFileSync(file.path));
    });

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    fs.writeFileSync(destinationPath, zipBuffer);

    const now = Date.now();
    const script = {
      id: crypto.randomUUID(),
      filename: displayFilename,
      stored_name: storedName,
      path: destinationPath,
      size: zipBuffer.length,
      originalSize,
      uploadedBy: req.user.username,
      uploadType: 'directory',
      originalDirectoryName: safeRootName,
      fileCount: files.length,
      createdAt: now,
      updatedAt: now,
    };

    store.addScript(script);
    persisted = true;
    store.addAudit({
      id: crypto.randomUUID(),
      ts: Date.now(),
      actor: req.user.username,
      action: 'script-upload-directory',
      deviceId: null,
      meta: `${displayFilename} (${files.length} files)`,
    });

    return res.json({ script: serializeScript(script) });
  } catch (err) {
    if (destinationPath && !persisted && fs.existsSync(destinationPath)) {
      try {
        fs.unlinkSync(destinationPath);
      } catch (cleanupErr) {
        console.warn(`Failed to remove incomplete directory upload ${destinationPath}:`, cleanupErr.message);
      }
    }

    if (err.message === 'invalid_relative_path' || err.message === 'duplicate_relative_path') {
      return res.status(400).json({ error: err.message });
    }

    console.error('Directory upload failed:', err);
    return res.status(500).json({ error: 'directory_upload_failed', message: err.message });
  } finally {
    cleanupUploadedTempFiles(files);
  }
});

app.get('/api/scripts/:id', deviceOrUserAuthRequired, (req, res) => {
  const scripts = store.data.scripts || [];
  const script = scripts.find((item) => item.id === req.params.id);
  if (!script) {
    return res.status(404).json({ error: 'Script not found' });
  }
  if (!fs.existsSync(script.path)) {
    return res.status(404).json({ error: 'File missing on server' });
  }

  res.download(script.path, script.filename);
});

app.delete('/api/scripts/:id', authRequired, (req, res) => {
  const scripts = store.data.scripts || [];
  const script = scripts.find((item) => item.id === req.params.id);
  if (!script) {
    return res.status(404).json({ error: 'Script not found' });
  }

  let fileDeleted = false;
  if (script.path && fs.existsSync(script.path)) {
    try {
      fs.unlinkSync(script.path);
      fileDeleted = true;
    } catch (err) {
      return res.status(500).json({ error: 'file_delete_failed', message: err.message });
    }
  }

  store.deleteScript(req.params.id);

  store.addAudit({
    id: crypto.randomUUID(),
    ts: Date.now(),
    actor: req.user.username,
    action: 'script-delete',
    deviceId: null,
    meta: script.filename,
  });

  return res.json({ status: 'ok', script: serializeScript(script), fileDeleted });
});

const reportUploads = multer({ dest: path.join(__dirname, '..', 'reports') });
fs.mkdirSync(path.join(__dirname, '..', 'reports'), { recursive: true });

app.post(
  '/api/tasks/:id/result',
  deviceOrUserAuthRequired,
  reportUploads.fields([{ name: 'log_file', maxCount: 1 }, { name: 'report_file', maxCount: 1 }]),
  (req, res) => {
  const taskId = req.params.id;
  const status = req.body.status;
  const message = req.body.message;
  const deviceId = req.body.device_id || req.body.deviceId || null;

  // Here we could store the result info into `store.js`
  // But for simple notification, we broadcast it to operators
  broadcastToOperators({
    type: 'task_result',
    task_id: taskId,
    deviceId,
    status,
    message,
    files: req.files ? Object.keys(req.files) : []
  });

  return res.json({ success: true });
});

const server = http.createServer(app);

const wssDevice = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  maxPayload: 16 * 1024 * 1024,
});

const wssOperator = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  maxPayload: 16 * 1024 * 1024,
});

server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try {
    pathname = new URL(req.url || '', `http://${req.headers.host}`).pathname;
  } catch {
    pathname = req.url || '';
  }

  if (pathname === '/ws/device') {
    wssDevice.handleUpgrade(req, socket, head, (ws) => {
      wssDevice.emit('connection', ws, req);
    });
    return;
  }

  if (pathname === '/ws/operator') {
    wssOperator.handleUpgrade(req, socket, head, (ws) => {
      wssOperator.emit('connection', ws, req);
    });
    return;
  }

  socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  socket.destroy();
});

console.log(
  `WebSocket perMessageDeflate: device=${wssDevice.options.perMessageDeflate} operator=${wssOperator.options.perMessageDeflate}`
);

const devices = new Map();
const operators = new Set();
const wsFrameDebug = process.env.WS_FRAME_DEBUG === '1';

/* -------------------- WebSocket Health Check -------------------- */

const WS_PING_INTERVAL = 15000; // 15 seconds
const WS_PONG_TIMEOUT = 10000; // 10 seconds

// Periodically ping all WebSocket connections
setInterval(() => {
  const now = Date.now();

  // Ping devices
  devices.forEach((entry, deviceId) => {
    const ws = entry.ws;
    if (ws.readyState !== ws.OPEN) {
      devices.delete(deviceId);
      updateDeviceState(deviceId, false);
      broadcastToOperators({ type: 'device-offline', deviceId });
      return;
    }

    // If we sent a ping and didn't get pong within timeout, terminate
    if (ws.isAlive === false) {
      console.log(`WS device ${deviceId} ping timeout, terminating`);
      ws.terminate();
      devices.delete(deviceId);
      updateDeviceState(deviceId, false);
      broadcastToOperators({ type: 'device-offline', deviceId });
      return;
    }

    ws.isAlive = false;
    ws.ping();
  });

  // Ping operators
  operators.forEach((ws) => {
    if (ws.readyState !== ws.OPEN) {
      operators.delete(ws);
      
      return;
    }

    if (ws.isAlive === false) {
      console.log(`WS operator ping timeout, terminating`);
      ws.terminate();
      operators.delete(ws);
      
      return;
    }

    ws.isAlive = false;
    ws.ping();
  });
}, WS_PING_INTERVAL);

/* -------------------- 共用工具 -------------------- */

function instrumentFrames(ws, label, req) {
  if (!wsFrameDebug || !ws || !ws._sender || typeof ws._sender.sendFrame !== 'function') {
    return;
  }

  const headers = req?.headers || {};
  const extensions = headers['sec-websocket-extensions'] || '';
  const protocol = headers['sec-websocket-protocol'] || '';
  const deflateEnabled = Boolean(ws._deflate);
  const remoteAddress = req?.socket?.remoteAddress || '';
  ws._debugLabel = label;
  ws._debugSentCount = 0;
  ws._debugRecvCount = 0;
  console.log(
    `WS ${label} debug: remote=${remoteAddress} reqExt=${extensions} proto=${protocol} ` +
    `wsExt=${ws.extensions || ''} deflate=${deflateEnabled}`
  );

  if (ws._socket && typeof ws._socket.write === 'function' && !ws._debugSocketWrapped) {
    ws._debugSocketWrapped = true;
    ws._debugSocketWriteCount = 0;
    const originalWrite = ws._socket.write.bind(ws._socket);
    ws._socket.write = (chunk, encoding, callback) => {
      if (wsFrameDebug && ws._debugSocketWriteCount < 5) {
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined);
        const prefix = buffer.slice(0, 8).toString();
        if (prefix.startsWith('HTTP/1')) {
          console.log(`WS ${label} socket write: HTTP response bytes=${buffer.length}`);
        } else if (buffer.length >= 2) {
          const b0 = buffer[0];
          const b1 = buffer[1];
          const fin = (b0 & 0x80) !== 0;
          const rsv1 = (b0 & 0x40) !== 0;
          const rsv2 = (b0 & 0x20) !== 0;
          const rsv3 = (b0 & 0x10) !== 0;
          const opcode = b0 & 0x0f;
          const masked = (b1 & 0x80) !== 0;
          const payloadLen = b1 & 0x7f;
          console.log(
            `WS ${label} socket write: fin=${fin} rsv1=${rsv1} rsv2=${rsv2} rsv3=${rsv3} ` +
            `opcode=${opcode} masked=${masked} len=${payloadLen} bytes=${buffer.length}`
          );
        } else {
          console.log(`WS ${label} socket write: bytes=${buffer.length}`);
        }
        ws._debugSocketWriteCount += 1;
      }
      return originalWrite(chunk, encoding, callback);
    };
  }

  let logged = 0;
  const originalSendFrame = ws._sender.sendFrame.bind(ws._sender);
  ws._sender.sendFrame = (frame, callback) => {
    if (logged < 5 && frame && frame.length) {
      const firstByte = frame[0];
      const fin = (firstByte & 0x80) !== 0;
      const rsv1 = (firstByte & 0x40) !== 0;
      const rsv2 = (firstByte & 0x20) !== 0;
      const rsv3 = (firstByte & 0x10) !== 0;
      const opcode = firstByte & 0x0f;
      console.log(
        `WS ${label} frame: fin=${fin} rsv1=${rsv1} rsv2=${rsv2} rsv3=${rsv3} opcode=${opcode} bytes=${frame.length}`
      );
      logged += 1;
    }
    return originalSendFrame(frame, callback);
  };
}

function sendBinary(ws, buffer) {
  if (ws.readyState === ws.OPEN) {
    if (wsFrameDebug && ws._debugSentCount < 5) {
      const label = ws._debugLabel || 'ws';
      const packetType = buffer.length > 0 ? buffer[0] : -1;
      console.log(`WS ${label} send binary: type=${packetType} bytes=${buffer.length}`);
      ws._debugSentCount += 1;
    }
    ws.send(buffer, { binary: true, fin: true, compress: false });
  }
}

function sendText(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    if (wsFrameDebug && ws._debugSentCount < 5) {
      const label = ws._debugLabel || 'ws';
      const payload = JSON.stringify(obj);
      console.log(`WS ${label} send text: bytes=${payload.length}`);
      ws._debugSentCount += 1;
    }
    ws.send(JSON.stringify(obj), { fin: true, compress: false });
  }
}

function broadcastToOperators(message) {
  operators.forEach((ws) => {
    if (ws.isAuthed) {
      sendText(ws, message);
    }
  });
}

function sendToDevice(deviceId, payload) {
  const entry = devices.get(deviceId);
  if (!entry || entry.ws.readyState !== entry.ws.OPEN) return false;
  if (wsFrameDebug && entry.ws._debugSentCount < 5) {
    const label = entry.ws._debugLabel || 'ws';
    console.log(`WS ${label} send to device: bytes=${payload.length}`);
    entry.ws._debugSentCount += 1;
  }
  entry.ws.send(payload, { fin: true, compress: false });
  return true;
}

function broadcastDeviceStatus(deviceId, patch) {
  store.updateDeviceStatus(deviceId, patch);
  const device = store.data.devices.find((item) => item.deviceId === deviceId);
  if (device) {
    broadcastToOperators({ type: 'device-status', device });
  }
}

function updateDeviceState(deviceId, online, info) {
  store.upsertDevice({
    deviceId,
    name: info?.name || deviceId,
    model: info?.model,
    manufacturer: info?.manufacturer,
    osVersion: info?.osVersion,
    appVersion: info?.appVersion,
    
    
    
    online,
    lastSeen: Date.now(),
  });
  const patch = { online };
  
  
  
  store.updateDeviceStatus(deviceId, patch);

  const device = store.data.devices.find((item) => item.deviceId === deviceId);
  broadcastToOperators({ type: 'device-status', device });
}








/* -------------------- Device WS -------------------- */

wssDevice.on('connection', (ws, req) => {
  let deviceId = null;
  instrumentFrames(ws, 'device', req);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data, isBinary) => {
    if (wsFrameDebug && ws._debugRecvCount < 5) {
      const label = ws._debugLabel || 'ws';
      const size = isBinary ? data.length : data.toString().length;
      console.log(`WS ${label} recv: binary=${isBinary} bytes=${size}`);
      ws._debugRecvCount += 1;
    }
    /* ---- TEXT ---- */
    if (!isBinary) {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (msg.type === 'hello') {
        if (msg.token !== deviceSharedKey) {
          ws.close(4001, 'invalid_device_token');
          return;
        }

        deviceId = msg.deviceId || crypto.randomUUID();

        // 檢查是否已有舊連線 (幽靈連線或重複連線) 存在
        const existing = devices.get(deviceId);
        if (existing) {
          console.log(`[WS] Device ${deviceId} reconnecting. Terminating old connection.`);
          // 停止進行中的錄影，避免檔案損毀或佔用
          if (existing.recording) {
            stopRecording(deviceId, 'system-reconnect');
          }
          // 強制中斷舊的連線
          existing.ws.terminate();
        }

        devices.set(deviceId, {
          ws,
          
          
          
        });

        updateDeviceState(deviceId, true, msg.info);
        sendText(ws, { type: 'welcome', deviceId });
        broadcastToOperators({ type: 'device-online', deviceId });
        return;
      }

      if (msg.type === 'heartbeat' && deviceId) {
        broadcastDeviceStatus(deviceId, { online: true });
        return;
      }

      if (msg.type === 'status' && deviceId) {
        const patch = { online: true };
        if (typeof msg.streaming === 'boolean') {
          patch.streaming = msg.streaming;
        }
        if (typeof msg.camera === 'boolean') {
          patch.camera = msg.camera;
        }
        if (typeof msg.mic === 'boolean') {
          patch.mic = msg.mic;
        }
        broadcastDeviceStatus(deviceId, patch);
        return;
      }

      if (msg.type === 'file_list_result' && deviceId) {
        broadcastToOperators({ ...msg, deviceId });
        return;
      }

      if (msg.type === 'file_delete_result' && deviceId) {
        broadcastToOperators({ ...msg, deviceId });
        return;
      }

      if (msg.type === 'file_download_start' && deviceId) {
        broadcastToOperators({ ...msg, deviceId });
        return;
      }

      if (msg.type === 'file_download_chunk' && deviceId) {
        broadcastToOperators({ ...msg, deviceId });
        return;
      }

      if (msg.type === 'file_download_complete' && deviceId) {
        broadcastToOperators({ ...msg, deviceId });
        return;
      }

      if (msg.type === 'file_upload_result' && deviceId) {
        broadcastToOperators({ ...msg, deviceId });
        return;
      }

      if (msg.type === 'shell_result' && deviceId) {
        broadcastToOperators({ ...msg, deviceId });
        return;
      }

      if (['log', 'task_result', 'task_event'].includes(msg.type) && deviceId) {
        broadcastToOperators({ ...msg, deviceId });
        return;
      }

      // If wait or generic signaling
      if (msg.type === 'signaling' && deviceId) {
        broadcastToOperators({ ...msg, deviceId });
        return;
      }

      return;
    }

    });

  ws.on('close', (code, reason) => {
    if (wsFrameDebug) {
      console.log(`WS device close: code=${code} reason=${reason ? reason.toString() : ''}`);
    }
    if (!deviceId) return;
    devices.delete(deviceId);
    updateDeviceState(deviceId, false);
    broadcastToOperators({ type: 'device-offline', deviceId });
  });

  ws.on('error', (err) => {
    if (wsFrameDebug) {
      console.log(`WS device error: ${err.message}`);
    }
  });
});

/* -------------------- Operator WS -------------------- */

wssOperator.on('connection', (ws, req) => {
  ws.isAuthed = false;
  ws.user = null;
  instrumentFrames(ws, 'operator', req);
  ws.authTimeout = setTimeout(() => {
    if (!ws.isAuthed && ws.readyState === ws.OPEN) {
      ws.close(4003, 'auth_required');
    }
  }, 10000);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === 'auth') {
      const user = verifySession(msg.token);
      if (!user) {
        sendText(ws, { type: 'auth-failed' });
        ws.close(4001, 'invalid_token');
        return;
      }
      ws.user = user;
      ws.isAuthed = true;
      if (ws.authTimeout) {
        clearTimeout(ws.authTimeout);
        ws.authTimeout = null;
      }
      operators.add(ws);
      sendText(ws, { type: 'auth-ok', user });
      return;
    }

    if (!ws.isAuthed) {
      sendText(ws, { type: 'auth-required' });
      return;
    }

    if (msg.type === 'watch') {
      
      const entry = devices.get(msg.deviceId);
      if (!entry) {
        sendText(ws, { type: 'watch-failed', reason: 'offline' });
        return;
      }

      entry.watchers.add(ws);

      if (entry.streamConfigs.screen) sendBinary(ws, entry.streamConfigs.screen);
      if (entry.streamConfigs.camera) sendBinary(ws, entry.streamConfigs.camera);
      if (entry.streamConfigs.audio) sendBinary(ws, entry.streamConfigs.audio);

      sendText(ws, { type: 'watch-ok', deviceId: msg.deviceId });
      return;
    }

    if (msg.type === 'unwatch') {
      
      sendText(ws, { type: 'unwatch-ok' });
      return;
    }

    if (['control', 'service', 'run_task', 'stop_task'].includes(msg.type)) {
      sendToDevice(msg.deviceId, JSON.stringify(msg));
    }
  });

  ws.on('close', (code, reason) => {
    if (wsFrameDebug) {
      console.log(`WS operator close: code=${code} reason=${reason ? reason.toString() : ''}`);
    }
    if (ws.authTimeout) {
      clearTimeout(ws.authTimeout);
      ws.authTimeout = null;
    }
    operators.delete(ws);
    
  });

  ws.on('error', (err) => {
    if (wsFrameDebug) {
      console.log(`WS operator error: ${err.message}`);
    }
  });
});

server.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
