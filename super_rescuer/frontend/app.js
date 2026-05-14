const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const loginButton = document.getElementById('loginButton');
const loginError = document.getElementById('loginError');
const loginTitle = document.getElementById('loginTitle');
const serverUrlPanel = document.getElementById('serverUrlSettings');
const serverUrlInput = document.getElementById('serverUrl');
const saveServerUrlButton = document.getElementById('saveServerUrl');
const resetServerUrlButton = document.getElementById('resetServerUrl');
const serverUrlStatus = document.getElementById('serverUrlStatus');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const sessionUser = document.getElementById('sessionUser');
const logoutButton = document.getElementById('logoutButton');
const deviceList = document.getElementById('deviceList');
const userManagementLink = document.getElementById('userManagementLink');

const wsStatusEl = document.getElementById('wsStatus');

// ======== Airtest Elements ========
const airtestUploadInput = document.getElementById('airtestUploadInput');
const airtestUploadBtn = document.getElementById('airtestUploadBtn');
const airtestScriptSelect = document.getElementById('airtestScriptSelect');
const airtestRefreshBtn = document.getElementById('airtestRefreshBtn');
const airtestVarsInput = document.getElementById('airtestVarsInput');
const airtestRunBtn = document.getElementById('airtestRunBtn');
const airtestStopBtn = document.getElementById('airtestStopBtn');
const airtestLogsOutput = document.getElementById('airtestLogsOutput');

const DEFAULT_SERVER_URL = window.location.origin;
let apiBase = '';
let authToken = '';
let ws = null;
let devices = [];
let wsHeartbeatTimer = null;
let wsReconnectTimer = null;
let wsReconnectAttempts = 0;
const WS_HEARTBEAT_INTERVAL = 15000;
const WS_RECONNECT_DELAY = 5000;
const WS_MAX_RECONNECT_ATTEMPTS = 50;

let currentDeviceId = null;
let currentUser = null;
const activeTasks = {};
const taskDeviceIndex = {};

const STORAGE_TOKEN_KEY = 'riderAuthToken';
const STORAGE_URL_KEY = 'riderServerUrl';

usernameInput.value = localStorage.getItem('riderUsername') || 'admin';
if (serverUrlInput) {
  let savedUrl = localStorage.getItem(STORAGE_URL_KEY);
  if (savedUrl === 'https://fleetmind.duckdns.org') savedUrl = null;
  serverUrlInput.value = savedUrl || DEFAULT_SERVER_URL;
}

function resolveApiBase() {
  let stored = localStorage.getItem(STORAGE_URL_KEY);
  if (stored === 'https://fleetmind.duckdns.org') {
    stored = null; // Force reset old hardcoded domain
  }
  if (stored) {
    return stored;
  }
  localStorage.setItem(STORAGE_URL_KEY, DEFAULT_SERVER_URL);
  return DEFAULT_SERVER_URL;
}

function showLogin() {
  loginView.classList.remove('hidden');
  appView.classList.add('hidden');
}

function showApp() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
}

function setError(message) {
  loginError.textContent = message || '';
}

function setServerUrlStatus(message, isError = false) {
  if (!serverUrlStatus) return;
  serverUrlStatus.textContent = message || '';
  serverUrlStatus.classList.toggle('error', isError);
}

function sanitizeServerUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function setAdminNavigationVisibility() {
  if (!userManagementLink) return;
  const isAdmin = currentUser?.role === 'admin';
  userManagementLink.classList.toggle('hidden', !isAdmin);
}

function toWsUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/operator';
  url.search = '';
  return url.toString();
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function login() {
  setError('');
  apiBase = resolveApiBase();

  if (loginButton.disabled) return;
  loginButton.disabled = true;
  loginButton.textContent = 'Signing in...';

  try {
    const data = await apiRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      }),
    });

    authToken = data.token;
    currentUser = data.user;
    sessionUser.textContent = `${data.user.username} (${data.user.role})`;
    localStorage.setItem(STORAGE_URL_KEY, apiBase);
    localStorage.setItem('riderUsername', usernameInput.value.trim());
    localStorage.setItem(STORAGE_TOKEN_KEY, authToken);

    showApp();
    setAdminNavigationVisibility();
    await loadData();
    connectWebSocket();
    fetchAirtestScripts();
  } catch (err) {
    const msg = String(err);
    if (msg.includes('429')) setError('Too many attempts. Wait 1 min.');
    else if (msg.includes('401')) setError('Invalid username/password.');
    else setError('Connection failed. Is server running?');
    console.warn('Login fail:', err);
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Sign In';
  }
}

function logout() {
  authToken = '';
  currentUser = null;
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  stopWsHeartbeat();
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  wsReconnectAttempts = 0;
  if (ws) {
    ws.close();
    ws = null;
  }
  setWsStatus('disconnected');
  showLogin();
}

async function loadData() {
  const deviceRes = await apiRequest('/api/devices');
  devices = deviceRes.devices || [];
  renderDevices();
}

async function restoreSession() {
  const storedToken = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  if (!storedToken) {
    showLogin();
    return;
  }

  apiBase = resolveApiBase();
  authToken = storedToken;

  try {
    const me = await apiRequest('/api/me');
    currentUser = me.user;
    sessionUser.textContent = `${me.user.username} (${me.user.role})`;
    showApp();
    setAdminNavigationVisibility();
    await loadData();
    connectWebSocket();
    fetchAirtestScripts();
  } catch (err) {
    authToken = '';
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    setError('Session expired. Please login again.');
    showLogin();
  }
}

function renderDevices() {
  deviceList.innerHTML = '';
  devices.forEach((device) => {
    if (device.deviceId === 'local-test' || device.name === 'local-test') return;
    if (!device.online) return;

    const card = document.createElement('div');
    const selected = currentDeviceId === device.deviceId;
    card.className = `device-card ${device.online ? 'online' : ''} ${selected ? 'selected' : ''}`.trim();

    const displayName = device.name || device.deviceId;
    const modelInfo = device.model || 'Unknown';
    const safeDisplayName = escapeHtml(displayName);
    const safeModelInfo = escapeHtml(modelInfo);
    const task = activeTasks[device.deviceId] || null;
    const safeTaskId = task ? escapeHtml(task.taskId) : '';
    const safeTaskStatus = task ? escapeHtml(task.status) : 'Idle';

    const statusText = device.online ? '<span class="text-success">Online</span>' : '<span class="text-danger">Offline</span>';

    card.innerHTML = `
      <div class="device-header">
        <h3 class="device-name" title="${safeDisplayName}">${safeDisplayName}</h3>
        <span class="device-indicator ${device.online ? 'online' : ''}"></span>
      </div>
      <div class="device-info muted">
        <i class="fas fa-mobile-alt"></i> ${safeModelInfo}
      </div>
      <div class="device-status">
        ${statusText}
      </div>
      <div class="device-task ${task ? task.status : 'idle'}">
        <span>Airtest: ${safeTaskStatus}</span>
        ${task ? `<span class="device-task-id" title="${safeTaskId}">${safeTaskId}</span>` : ''}
      </div>
      ${task ? `<button class="danger device-stop-task" type="button" ${task.status === 'stopping' ? 'disabled' : ''}>Stop Task</button>` : ''}
    `;

    card.addEventListener('click', () => {
      currentDeviceId = device.deviceId;
      renderDevices();
      updateAirtestControls();
    });
    const stopTaskButton = card.querySelector('.device-stop-task');
    if (stopTaskButton) {
      stopTaskButton.addEventListener('click', (event) => {
        event.stopPropagation();
        requestStopTask(device.deviceId);
      });
    }
    deviceList.appendChild(card);
  });
  updateAirtestControls();
}

function setWsStatus(status) {
  if (wsStatusEl) {
    wsStatusEl.className = `ws-status ${status}`;
    wsStatusEl.title = `WebSocket ${status}`;
  }
}

function startWsHeartbeat() {
  stopWsHeartbeat();
  wsHeartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, WS_HEARTBEAT_INTERVAL);
}

function stopWsHeartbeat() {
  if (wsHeartbeatTimer) {
    clearInterval(wsHeartbeatTimer);
    wsHeartbeatTimer = null;
  }
}

function scheduleWsReconnect() {
  if (wsReconnectTimer) return;
  if (!authToken) return;

  wsReconnectAttempts++;
  if (wsReconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) {
    setWsStatus('disconnected');
    return;
  }

  setWsStatus('reconnecting');
  const baseDelay = WS_RECONNECT_DELAY;
  const exponentialDelay = baseDelay * Math.pow(2, Math.min(wsReconnectAttempts - 1, 5));
  const delay = Math.min(exponentialDelay, 30000);

  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, delay);
}

function connectWebSocket() {
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
  stopWsHeartbeat();

  ws = new WebSocket(toWsUrl(apiBase));
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    wsReconnectAttempts = 0;
    setWsStatus('connected');
    ws.send(JSON.stringify({ type: 'auth', token: authToken }));
    startWsHeartbeat();
  });

  ws.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      handleTextMessage(event.data);
    }
  });

  ws.addEventListener('close', () => {
    stopWsHeartbeat();
    setWsStatus('disconnected');
    scheduleWsReconnect();
  });

  ws.addEventListener('error', () => {
    stopWsHeartbeat();
    setWsStatus('disconnected');
  });
}

function handleTextMessage(data) {
  let message;
  try {
    message = JSON.parse(data);
  } catch (err) {
    return;
  }

  if (message.type === 'device-status' && message.device) {
    const index = devices.findIndex((d) => d.deviceId === message.device.deviceId);
    if (index >= 0) {
      devices[index] = message.device;
    } else {
      devices.push(message.device);
    }
    if (message.device.online === false && activeTasks[message.device.deviceId]) {
      appendAirtestLog(`\n[System][${message.device.deviceId}] Device went offline; clearing active task state.\n`);
      clearDeviceTask(message.device.deviceId);
    }
    renderDevices();
    return;
  }

  // --- Airtest Events ---
  if (message.type === 'log') {
    appendDeviceLog(message);
    return;
  }

  if (message.type === 'task_result') {
    handleAirtestTaskResult(message);
    return;
  }

  if (message.type === 'task_event') {
    handleAirtestTaskEvent(message);
    return;
  }
}

// ======== Airtest Operations ========
async function fetchAirtestScripts() {
  if (!airtestScriptSelect) return;
  try {
    const data = await apiRequest('/api/scripts');
    const scripts = data.scripts || [];
    airtestScriptSelect.innerHTML = '<option value="">-- Select Script --</option>';
    scripts.forEach(script => {
      const option = document.createElement('option');
      option.value = script.id;
      option.textContent = script.filename;
      airtestScriptSelect.appendChild(option);
    });
  } catch (err) {
    console.error('Failed to load airtest scripts:', err);
  }
}

if (airtestRefreshBtn) {
  airtestRefreshBtn.addEventListener('click', fetchAirtestScripts);
}

if (airtestUploadBtn) {
  airtestUploadBtn.addEventListener('click', async () => {
    const file = airtestUploadInput.files[0];
    if (!file) return;

    airtestUploadBtn.disabled = true;
    airtestUploadBtn.textContent = 'Uploading...';

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${apiBase}/api/scripts/upload`, {
        method: 'POST',
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      airtestUploadInput.value = '';
      await fetchAirtestScripts();
    } catch (err) {
      alert(err.message);
    } finally {
      airtestUploadBtn.disabled = false;
      airtestUploadBtn.textContent = 'Upload Script';
    }
  });
}

if (airtestRunBtn) {
  airtestRunBtn.addEventListener('click', () => {
    const scriptId = airtestScriptSelect.value;
    if (!scriptId) {
      alert('Please select a script');
      return;
    }

    if (!currentDeviceId) {
      alert('Please select a device from the list first!');
      return;
    }

    if (activeTasks[currentDeviceId]) {
      alert('Selected device is already running a task.');
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      alert('WebSocket is not connected.');
      return;
    }

    let vars = {};
    if (airtestVarsInput.value.trim()) {
      try {
        vars = JSON.parse(airtestVarsInput.value);
      } catch (err) {
        alert('Variables must be valid JSON');
        return;
      }
    }

    const taskId = Date.now().toString();
    setDeviceTask(currentDeviceId, taskId, 'running');
    appendAirtestLog(`\n[System][${currentDeviceId}][${taskId}] Starting task with script ${scriptId}...\n`);

    try {
      ws.send(JSON.stringify({
        type: 'run_task',
        deviceId: currentDeviceId,
        task_id: taskId,
        script_id: scriptId,
        script_url: `${apiBase}/api/scripts/${scriptId}`,
        vars: vars
      }));
    } catch (err) {
      clearDeviceTask(currentDeviceId, taskId);
      appendAirtestLog(`[System] Failed to send task: ${err.message}\n`);
    }
  });
}

if (airtestStopBtn) {
  airtestStopBtn.addEventListener('click', () => {
    if (!currentDeviceId) {
      return;
    }
    requestStopTask(currentDeviceId);
  });
}

function setDeviceTask(deviceId, taskId, status = 'running') {
  if (!deviceId || !taskId) return;
  activeTasks[deviceId] = { taskId, status };
  taskDeviceIndex[taskId] = deviceId;
  renderDevices();
  updateAirtestControls();
}

function updateDeviceTaskStatus(deviceId, status) {
  const task = activeTasks[deviceId];
  if (!task) return;
  task.status = status;
  renderDevices();
  updateAirtestControls();
}

function clearDeviceTask(deviceId, taskId = null) {
  const task = activeTasks[deviceId];
  if (!task) return;
  if (taskId && task.taskId !== taskId) return;
  delete activeTasks[deviceId];
  renderDevices();
  updateAirtestControls();
}

function updateAirtestControls() {
  const selectedTask = currentDeviceId ? activeTasks[currentDeviceId] : null;
  if (airtestRunBtn) {
    airtestRunBtn.disabled = Boolean(selectedTask);
    airtestRunBtn.textContent = selectedTask
      ? selectedTask.status === 'stopping' ? 'Stopping...' : 'Running...'
      : 'Run Task';
  }
  if (airtestStopBtn) {
    airtestStopBtn.disabled = !selectedTask || selectedTask.status === 'stopping';
    airtestStopBtn.textContent = selectedTask?.status === 'stopping' ? 'Stopping...' : 'Stop Task';
  }
}

function requestStopTask(deviceId) {
  const task = activeTasks[deviceId];
  if (!task) {
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('WebSocket is not connected.');
    return;
  }

  appendAirtestLog(`\n[System][${deviceId}][${task.taskId}] Stop requested...\n`);
  updateDeviceTaskStatus(deviceId, 'stopping');
  try {
    ws.send(JSON.stringify({
      type: 'stop_task',
      deviceId,
      task_id: task.taskId,
    }));
  } catch (err) {
    updateDeviceTaskStatus(deviceId, 'running');
    appendAirtestLog(`[System][${deviceId}][${task.taskId}] Failed to send stop: ${err.message}\n`);
  }
}

function appendAirtestLog(text) {
  if (!airtestLogsOutput) return;
  const chunk = document.createTextNode(text);
  airtestLogsOutput.appendChild(chunk);
  airtestLogsOutput.scrollTop = airtestLogsOutput.scrollHeight;
}

function resolveTaskDeviceId(msg) {
  if (msg.deviceId) {
    return msg.deviceId;
  }
  if (msg.task_id && taskDeviceIndex[msg.task_id]) {
    return taskDeviceIndex[msg.task_id];
  }
  return null;
}

function appendDeviceLog(msg) {
  const deviceId = resolveTaskDeviceId(msg) || 'unknown-device';
  const text = msg.message || msg.text || '';
  const suffix = text.endsWith('\n') ? '' : '\n';
  appendAirtestLog(`[${deviceId}] ${text}${suffix}`);
}

function handleAirtestTaskResult(msg) {
  const deviceId = resolveTaskDeviceId(msg);
  const prefix = deviceId ? `[${deviceId}][${msg.task_id}]` : `[${msg.task_id}]`;
  appendAirtestLog(`\n[System]${prefix} Task completed with status: ${msg.status}\n`);
  if (msg.message) {
    appendAirtestLog(`[System] Message: ${msg.message}\n`);
  }
  if (msg.files && msg.files.length > 0) {
    appendAirtestLog(`[System] Downloaded artifacts: ${msg.files.join(', ')}\n`);
  }
  if (deviceId) {
    clearDeviceTask(deviceId, msg.task_id);
  }
}

function handleAirtestTaskEvent(msg) {
  const deviceId = resolveTaskDeviceId(msg);
  const event = msg.event || 'event';
  const task = msg.task_id ? ` task ${msg.task_id}` : '';
  const message = msg.message ? `: ${msg.message}` : '';
  const prefix = deviceId ? `[${deviceId}]` : '';
  appendAirtestLog(`\n[System]${prefix} ${event}${task}${message}\n`);
  if (event === 'stop_requested' && deviceId) {
    updateDeviceTaskStatus(deviceId, 'stopping');
  }
  if (event === 'stop_ignored' && deviceId) {
    clearDeviceTask(deviceId, msg.task_id);
  }
}

// ======== Event Listeners & Init ========
if (loginButton) loginButton.addEventListener('click', login);
if (passwordInput) passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
if (logoutButton) logoutButton.addEventListener('click', logout);

document.addEventListener('DOMContentLoaded', () => {
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    setTimeout(() => {
      loadingOverlay.classList.add('hidden');
      setTimeout(() => {
        loadingOverlay.style.display = 'none';
      }, 500);
    }, 800);
  }
  
  restoreSession();
});

// Settings interactions
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'u') {
    e.preventDefault();
    if (serverUrlPanel) serverUrlPanel.classList.toggle('hidden');
  }
});
if (saveServerUrlButton) {
  saveServerUrlButton.addEventListener('click', () => {
    const url = sanitizeServerUrl(serverUrlInput.value);
    if (!url) {
      setServerUrlStatus('URL cannot be empty', true);
      return;
    }
    try {
      new URL(url);
    } catch {
      setServerUrlStatus('Invalid URL format', true);
      return;
    }
    localStorage.setItem(STORAGE_URL_KEY, url);
    setServerUrlStatus('Saved', false);
    setTimeout(() => setServerUrlStatus(''), 2000);
  });
}
if (resetServerUrlButton) {
  resetServerUrlButton.addEventListener('click', () => {
    serverUrlInput.value = DEFAULT_SERVER_URL;
    localStorage.setItem(STORAGE_URL_KEY, DEFAULT_SERVER_URL);
    setServerUrlStatus('Reset to default', false);
    setTimeout(() => setServerUrlStatus(''), 2000);
  });
}
