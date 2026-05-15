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
const airtestDirectoryInput = document.getElementById('airtestDirectoryInput');
const airtestDirectoryBtn = document.getElementById('airtestDirectoryBtn');
const airtestScriptSelect = document.getElementById('airtestScriptSelect');
const airtestRefreshBtn = document.getElementById('airtestRefreshBtn');
const airtestVarsInput = document.getElementById('airtestVarsInput');
const airtestRunBtn = document.getElementById('airtestRunBtn');
const airtestStopBtn = document.getElementById('airtestStopBtn');
const airtestScriptList = document.getElementById('airtestScriptList');
const airtestScriptCount = document.getElementById('airtestScriptCount');
const airtestLogsOutput = document.getElementById('airtestLogsOutput');
const airtestLogsClearBtn = document.getElementById('airtestLogsClearBtn');
const airtestStatsResetBtn = document.getElementById('airtestStatsResetBtn');
const airtestStatsSummary = document.getElementById('airtestStatsSummary');
const airtestCustomStats = document.getElementById('airtestCustomStats');
const stdinInputArea = document.getElementById('stdinInputArea');
const stdinPromptLabel = document.getElementById('stdinPromptLabel');
const stdinInputField = document.getElementById('stdinInputField');
const stdinSendBtn = document.getElementById('stdinSendBtn');
const reportRefreshBtn = document.getElementById('reportRefreshBtn');
const reportFromDate = document.getElementById('reportFromDate');
const reportToDate = document.getElementById('reportToDate');
const reportAgentSelect = document.getElementById('reportAgentSelect');
const reportDeviceSelect = document.getElementById('reportDeviceSelect');
const reportScriptSelect = document.getElementById('reportScriptSelect');
const reportSoftwareSelect = document.getElementById('reportSoftwareSelect');
const reportStatusSelect = document.getElementById('reportStatusSelect');
const reportStatusText = document.getElementById('reportStatusText');
const reportSummary = document.getElementById('reportSummary');
const reportRunsBody = document.getElementById('reportRunsBody');
const reportDetail = document.getElementById('reportDetail');

let _pendingStdinDeviceId = null;
let _pendingStdinTaskId = null;

const DEFAULT_SERVER_URL = window.location.origin;
let apiBase = '';
let authToken = '';
let ws = null;
let devices = [];
let airtestScripts = [];
let wsHeartbeatTimer = null;
let wsReconnectTimer = null;
let wsReconnectAttempts = 0;
const WS_HEARTBEAT_INTERVAL = 15000;
const WS_RECONNECT_DELAY = 5000;
const WS_MAX_RECONNECT_ATTEMPTS = 50;

let currentDeviceId = null;
let currentUser = null;
let reportRuns = [];
let selectedReportTaskId = null;
const activeTasks = {};
const taskDeviceIndex = {};
const airtestStatsState = {
  totals: {
    runs: 0,
    succeeded: 0,
    failed: 0,
    stopped: 0,
  },
  byDevice: {},
  lastDeviceId: null,
  completedTasks: new Set(),
};
let airtestStatsTimer = null;

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

function formatTimestamp(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString();
}

function formatBytes(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'Unknown size';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatDuration(value) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return '--:--';
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatStatValue(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value ?? '');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatCount(value) {
  const number = toNumber(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function formatShortText(value, maxLength = 18) {
  const text = String(value || '--');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function getUploadRelativePath(file) {
  return file.webkitRelativePath || file.name;
}

function getDirectoryRootName(files) {
  const firstRelativePath = files[0] ? getUploadRelativePath(files[0]) : '';
  return firstRelativePath.split('/').filter(Boolean)[0] || 'airtest-directory';
}

async function getResponseErrorMessage(response, fallback) {
  try {
    const data = await response.json();
    return data.message || data.error || fallback;
  } catch (err) {
    return fallback;
  }
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
    loadReportOptions();
    loadReports();
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
    loadReportOptions();
    loadReports();
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
      renderAirtestStats();
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
    try { ws.close(); } catch (_) { }
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

  if (message.type === 'input_prompt') {
    handleInputPrompt(message);
    return;
  }

  if (message.type === 'restore-tasks') {
    handleRestoreTasks(message.tasks || []);
    return;
  }

  if (message.type === 'task_result') {
    hideStdinInput();
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
    airtestScripts = scripts;
    airtestScriptSelect.innerHTML = '<option value="">-- Select Script --</option>';
    scripts.forEach(script => {
      const option = document.createElement('option');
      option.value = script.id;
      option.textContent = script.filename;
      airtestScriptSelect.appendChild(option);
    });
    renderAirtestScriptList();
  } catch (err) {
    console.error('Failed to load airtest scripts:', err);
    if (airtestScriptList) {
      airtestScriptList.innerHTML = '<div class="script-empty">Unable to load scripts.</div>';
    }
  }
}

function renderAirtestScriptList() {
  if (!airtestScriptList) return;
  if (airtestScriptCount) {
    airtestScriptCount.textContent = `${airtestScripts.length} item${airtestScripts.length === 1 ? '' : 's'}`;
  }

  if (!airtestScripts.length) {
    airtestScriptList.innerHTML = '<div class="script-empty">No uploaded scripts.</div>';
    return;
  }

  airtestScriptList.innerHTML = '';
  const sortedScripts = [...airtestScripts].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  sortedScripts.forEach((script) => {
    const item = document.createElement('div');
    item.className = 'script-item';
    item.dataset.scriptId = script.id;
    const safeFilename = escapeHtml(script.filename || '');
    const uploadedAt = escapeHtml(formatTimestamp(script.createdAt));
    const updatedAt = script.updatedAt && script.updatedAt !== script.createdAt
      ? `Updated ${escapeHtml(formatTimestamp(script.updatedAt))}`
      : '';
    const uploadedBy = script.uploadedBy ? ` by ${escapeHtml(script.uploadedBy)}` : '';
    const size = escapeHtml(formatBytes(script.size));
    const missingClass = script.fileExists === false ? ' text-danger' : '';
    const missingText = script.fileExists === false ? 'Missing file' : size;
    const isDirectoryUpload = script.uploadType === 'directory';
    const uploadType = isDirectoryUpload ? 'Directory ZIP' : 'File';
    const fileCount = isDirectoryUpload && typeof script.fileCount === 'number'
      ? `${script.fileCount} file${script.fileCount === 1 ? '' : 's'}`
      : '';
    const sourceName = isDirectoryUpload && script.originalDirectoryName
      ? `Source ${escapeHtml(script.originalDirectoryName)}`
      : '';

    item.innerHTML = `
      <div class="script-main">
        <div class="script-name" title="${safeFilename}">${safeFilename}</div>
        <div class="script-meta">
          Uploaded ${uploadedAt}${uploadedBy}
          <span>${escapeHtml(uploadType)}</span>
          ${fileCount ? `<span>${escapeHtml(fileCount)}</span>` : ''}
          ${sourceName ? `<span>${sourceName}</span>` : ''}
          <span class="${missingClass}">${escapeHtml(missingText)}</span>
          ${updatedAt ? `<span>${updatedAt}</span>` : ''}
        </div>
      </div>
      <div class="script-actions">
        <button class="ghost script-select-btn" type="button">Select</button>
        <button class="ghost script-download-btn" type="button" ${script.fileExists === false ? 'disabled' : ''}>Download</button>
        <button class="danger script-delete-btn" type="button">Delete</button>
      </div>
    `;

    item.querySelector('.script-select-btn')?.addEventListener('click', () => {
      airtestScriptSelect.value = script.id;
    });
    item.querySelector('.script-download-btn')?.addEventListener('click', () => {
      downloadAirtestScript(script);
    });
    item.querySelector('.script-delete-btn')?.addEventListener('click', () => {
      deleteAirtestScript(script);
    });
    airtestScriptList.appendChild(item);
  });
}

async function downloadAirtestScript(script) {
  try {
    const response = await fetch(`${apiBase}/api/scripts/${script.id}`, {
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = script.filename || 'script.air';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteAirtestScript(script) {
  const confirmed = window.confirm(`Delete uploaded script "${script.filename}"?`);
  if (!confirmed) return;

  try {
    await apiRequest(`/api/scripts/${script.id}`, { method: 'DELETE' });
    if (airtestScriptSelect.value === script.id) {
      airtestScriptSelect.value = '';
    }
    await fetchAirtestScripts();
  } catch (err) {
    alert(err.message);
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
        throw new Error(await getResponseErrorMessage(response, `Upload failed: ${response.status}`));
      }

      airtestUploadInput.value = '';
      await fetchAirtestScripts();
    } catch (err) {
      alert(err.message);
    } finally {
      airtestUploadBtn.disabled = false;
      airtestUploadBtn.textContent = 'Upload ZIP';
    }
  });
}

if (airtestDirectoryBtn && airtestDirectoryInput) {
  airtestDirectoryBtn.addEventListener('click', () => {
    airtestDirectoryInput.click();
  });

  airtestDirectoryInput.addEventListener('change', async () => {
    const files = Array.from(airtestDirectoryInput.files || []);
    if (!files.length) return;

    const relativePaths = files.map(getUploadRelativePath);
    const formData = new FormData();
    formData.append('rootName', getDirectoryRootName(files));
    formData.append('relativePathsJson', JSON.stringify(relativePaths));
    files.forEach((file) => {
      formData.append('files', file, file.name);
    });

    airtestDirectoryBtn.disabled = true;
    airtestDirectoryBtn.textContent = 'Uploading...';

    try {
      const response = await fetch(`${apiBase}/api/scripts/upload-directory`, {
        method: 'POST',
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, `Folder upload failed: ${response.status}`));
      }

      await fetchAirtestScripts();
    } catch (err) {
      alert(err.message);
    } finally {
      airtestDirectoryInput.value = '';
      airtestDirectoryBtn.disabled = false;
      airtestDirectoryBtn.textContent = 'Upload Folder';
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
    const selectedScript = airtestScripts.find((script) => script.id === scriptId);

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
    beginAirtestStats(currentDeviceId, taskId, selectedScript?.filename || scriptId);
    setDeviceTask(currentDeviceId, taskId, 'running');
    appendAirtestLog(`\n[System][${currentDeviceId}][${taskId}] Starting task with script ${scriptId}...\n`);

    try {
      ws.send(JSON.stringify({
        type: 'run_task',
        deviceId: currentDeviceId,
        task_id: taskId,
        script_id: scriptId,
        script_url: `${apiBase}/api/scripts/${scriptId}`,
        script_name: selectedScript?.filename || 'script.zip',
        vars: vars
      }));
    } catch (err) {
      finishAirtestStats(currentDeviceId, taskId, 'failed');
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

function getDeviceStats(deviceId) {
  if (!deviceId) return null;
  if (!airtestStatsState.byDevice[deviceId]) {
    airtestStatsState.byDevice[deviceId] = {
      current: null,
      last: null,
      custom: {},
    };
  }
  return airtestStatsState.byDevice[deviceId];
}

function beginAirtestStats(deviceId, taskId, scriptName) {
  const stats = getDeviceStats(deviceId);
  if (!stats) return;
  airtestStatsState.lastDeviceId = deviceId;
  stats.custom = {};
  stats.current = {
    taskId,
    scriptName,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
  };
  stats.last = stats.current;
  airtestStatsState.totals.runs += 1;
  renderAirtestStats();
  ensureAirtestStatsTimer();
}

function finishAirtestStats(deviceId, taskId, status) {
  const stats = getDeviceStats(deviceId);
  if (!stats) return;
  airtestStatsState.lastDeviceId = deviceId || airtestStatsState.lastDeviceId;

  const taskKey = taskId ? `${deviceId || 'unknown'}:${taskId}` : null;
  const alreadyCompleted = taskKey && airtestStatsState.completedTasks.has(taskKey);
  const current = stats.current && (!taskId || stats.current.taskId === taskId)
    ? stats.current
    : stats.last;

  if (current && (!taskId || current.taskId === taskId)) {
    current.status = status || 'completed';
    current.endedAt = current.endedAt || Date.now();
    stats.last = current;
    if (stats.current && stats.current.taskId === current.taskId) {
      stats.current = null;
    }
  }

  if (!alreadyCompleted) {
    if (['succeeded', 'success', 'passed'].includes(status)) airtestStatsState.totals.succeeded += 1;
    else if (status === 'stopped') airtestStatsState.totals.stopped += 1;
    else airtestStatsState.totals.failed += 1;
    if (taskKey) airtestStatsState.completedTasks.add(taskKey);
  }

  renderAirtestStats();
  stopAirtestStatsTimerIfIdle();
}

function ensureAirtestStatsTimer() {
  if (airtestStatsTimer) return;
  airtestStatsTimer = setInterval(renderAirtestStats, 1000);
}

function stopAirtestStatsTimerIfIdle() {
  const hasRunning = Object.values(airtestStatsState.byDevice).some((stats) => stats.current);
  if (!hasRunning && airtestStatsTimer) {
    clearInterval(airtestStatsTimer);
    airtestStatsTimer = null;
  }
}

function resetAirtestStats() {
  airtestStatsState.totals.runs = 0;
  airtestStatsState.totals.succeeded = 0;
  airtestStatsState.totals.failed = 0;
  airtestStatsState.totals.stopped = 0;
  airtestStatsState.byDevice = {};
  airtestStatsState.lastDeviceId = null;
  airtestStatsState.completedTasks.clear();
  stopAirtestStatsTimerIfIdle();
  renderAirtestStats();
}

function getVisibleStatsDeviceId() {
  if (currentDeviceId && airtestStatsState.byDevice[currentDeviceId]) {
    return currentDeviceId;
  }
  return airtestStatsState.lastDeviceId;
}

function renderAirtestStats() {
  if (!airtestStatsSummary || !airtestCustomStats) return;

  const deviceId = getVisibleStatsDeviceId();
  const stats = deviceId ? airtestStatsState.byDevice[deviceId] : null;
  const task = stats?.current || stats?.last || null;
  const now = Date.now();
  const duration = task
    ? (task.endedAt || now) - task.startedAt
    : null;
  const finished = airtestStatsState.totals.succeeded + airtestStatsState.totals.failed + airtestStatsState.totals.stopped;
  const successRate = finished > 0
    ? `${Math.round((airtestStatsState.totals.succeeded / finished) * 100)}%`
    : '--';
  const summaryItems = [
    ['Device', deviceId || '--'],
    ['Status', task?.status || 'idle'],
    ['Duration', duration === null ? '--:--' : formatDuration(duration)],
    ['Runs', airtestStatsState.totals.runs],
    ['Success Rate', successRate],
    ['Script', task?.scriptName || '--'],
  ];

  airtestStatsSummary.innerHTML = summaryItems.map(([label, value]) => `
    <div class="stat-tile">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(value)}</strong>
    </div>
  `).join('');

  const customEntries = Object.entries(stats?.custom || {});
  if (!customEntries.length) {
    airtestCustomStats.innerHTML = '<div class="stats-empty">No custom stats.</div>';
    return;
  }

  airtestCustomStats.innerHTML = customEntries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `
      <div class="stat-row">
        <span class="stat-key">${escapeHtml(key)}</span>
        <strong class="stat-row-value">${escapeHtml(formatStatValue(entry.value))}</strong>
      </div>
    `).join('');
}

function parseStatLine(line) {
  const statIndex = line.indexOf('[STAT]');
  if (statIndex < 0) return null;
  const body = line.slice(statIndex + 6).trim();
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
    const amount = Number(addMatch[3]) * (addMatch[2] === '-' ? -1 : 1);
    return {
      key: addMatch[1],
      op: 'add',
      value: amount,
    };
  }

  return null;
}

function applyStatLine(deviceId, line) {
  const parsed = parseStatLine(line);
  if (!parsed) return false;
  const stats = getDeviceStats(deviceId || airtestStatsState.lastDeviceId || 'unknown-device');
  if (!stats) return false;

  airtestStatsState.lastDeviceId = deviceId || airtestStatsState.lastDeviceId;
  const currentEntry = stats.custom[parsed.key];
  if (parsed.op === 'add') {
    const base = typeof currentEntry?.value === 'number' ? currentEntry.value : Number(currentEntry?.value || 0);
    stats.custom[parsed.key] = {
      value: (Number.isNaN(base) ? 0 : base) + parsed.value,
      updatedAt: Date.now(),
    };
  } else {
    stats.custom[parsed.key] = {
      value: parsed.value,
      updatedAt: Date.now(),
    };
  }
  renderAirtestStats();
  return true;
}

function processStatLines(deviceId, text) {
  String(text || '').split(/\r?\n/).forEach((line) => {
    applyStatLine(deviceId, line);
  });
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

function clearAirtestLogs() {
  if (!airtestLogsOutput) return;
  airtestLogsOutput.textContent = '';
}

function setReportStatus(message, isError = false) {
  if (!reportStatusText) return;
  reportStatusText.textContent = message || '';
  reportStatusText.classList.toggle('error', isError);
}

function populateReportSelect(select, values, placeholder) {
  if (!select) return;
  const currentValue = select.value;
  const options = [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat((values || []).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));
  select.innerHTML = options.join('');
  if ((values || []).includes(currentValue)) {
    select.value = currentValue;
  }
}

function dateInputToIso(value, endOfDay = false) {
  if (!value) return '';
  const parts = value.split('-').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return '';
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (endOfDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function buildReportQuery() {
  const params = new URLSearchParams();
  const from = dateInputToIso(reportFromDate?.value || '');
  const to = dateInputToIso(reportToDate?.value || '', true);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (reportAgentSelect?.value) params.set('agentId', reportAgentSelect.value);
  if (reportDeviceSelect?.value) params.set('deviceId', reportDeviceSelect.value);
  if (reportScriptSelect?.value) params.set('scriptName', reportScriptSelect.value);
  if (reportSoftwareSelect?.value) params.set('softwareVersion', reportSoftwareSelect.value);
  if (reportStatusSelect?.value) params.set('status', reportStatusSelect.value);
  params.set('limit', '200');
  const query = params.toString();
  return query ? `?${query}` : '';
}

function getReportStat(run, key) {
  return run?.stats?.[key]?.value ?? null;
}

function getReportNumber(run, key) {
  return toNumber(getReportStat(run, key));
}

function getReportText(run, key, fallback = '--') {
  const value = getReportStat(run, key);
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function getReportRunDurationMs(run) {
  if (run?.duration_ms !== null && run?.duration_ms !== undefined) {
    return toNumber(run.duration_ms, null);
  }
  const durationSeconds = getReportStat(run, 'duration_seconds');
  if (durationSeconds !== null && durationSeconds !== undefined) {
    return toNumber(durationSeconds) * 1000;
  }
  if (run?.status === 'running' && run.started_at) {
    const startedAt = new Date(run.started_at).getTime();
    if (!Number.isNaN(startedAt)) return Math.max(0, Date.now() - startedAt);
  }
  return null;
}

function getReportRunStatus(run) {
  return getReportText(run, 'result', run?.status || 'unknown');
}

function statusClassName(status) {
  return String(status || 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function renderReportSummary(summary = {}) {
  if (!reportSummary) return;
  const totalRuns = toNumber(summary.total_runs);
  const succeededRuns = toNumber(summary.succeeded_runs);
  const failedRuns = toNumber(summary.failed_runs);
  const stoppedRuns = toNumber(summary.stopped_runs);
  const runningRuns = toNumber(summary.running_runs);
  const finishedRuns = succeededRuns + failedRuns + stoppedRuns;
  const successRate = finishedRuns > 0 ? `${((succeededRuns / finishedRuns) * 100).toFixed(1)}%` : '--';
  const items = [
    ['Total Runs', formatCount(totalRuns)],
    ['Succeeded', formatCount(succeededRuns)],
    ['Failed', formatCount(failedRuns)],
    ['Running', formatCount(runningRuns)],
    ['Success Rate', successRate],
    ['Total Duration', formatDuration(toNumber(summary.total_duration_ms))],
    ['Avg Duration', formatDuration(toNumber(summary.average_duration_ms))],
    ['Rounds', `${formatCount(summary.total_round_completed)} / ${formatCount(summary.total_round_started)}`],
    ['Selected Tables', formatCount(summary.total_tables_selected)],
    ['Served Tables', formatCount(summary.total_table_served)],
  ];

  reportSummary.innerHTML = items.map(([label, value]) => `
    <div class="stat-tile">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(value)}</strong>
    </div>
  `).join('');
}

function renderReportTable() {
  if (!reportRunsBody) return;
  if (!reportRuns.length) {
    reportRunsBody.innerHTML = '<tr><td colspan="11" class="report-empty">No report data.</td></tr>';
    if (reportDetail) reportDetail.classList.add('hidden');
    return;
  }

  reportRunsBody.innerHTML = reportRuns.map((run) => {
    const status = getReportRunStatus(run);
    const agentId = getReportText(run, 'agent_id', run.device_id || '--');
    const deviceSerial = getReportText(run, 'device_serial', run.device_id || '--');
    const softwareVersion = getReportText(run, 'software_version');
    const durationMs = getReportRunDurationMs(run);
    const rounds = `${formatCount(getReportNumber(run, 'round_completed'))}/${formatCount(getReportNumber(run, 'round_started'))}`;
    const selected = formatCount(getReportNumber(run, 'tables_selected'));
    const served = formatCount(getReportNumber(run, 'table_served'));
    const lastTable = getReportText(run, 'last_table');
    return `
      <tr>
        <td>${escapeHtml(formatTimestamp(run.started_at))}</td>
        <td class="report-mono" title="${escapeHtml(agentId)}">${escapeHtml(formatShortText(agentId, 22))}</td>
        <td class="report-mono" title="${escapeHtml(deviceSerial)}">${escapeHtml(formatShortText(deviceSerial, 18))}</td>
        <td class="report-mono" title="${escapeHtml(softwareVersion)}">${escapeHtml(formatShortText(softwareVersion, 18))}</td>
        <td><span class="status-pill ${escapeHtml(statusClassName(status))}">${escapeHtml(status)}</span></td>
        <td>${durationMs === null ? '--:--' : escapeHtml(formatDuration(durationMs))}</td>
        <td>${escapeHtml(rounds)}</td>
        <td>${escapeHtml(selected)}</td>
        <td>${escapeHtml(served)}</td>
        <td>${escapeHtml(lastTable)}</td>
        <td><button type="button" class="ghost compact report-view-btn" data-task-id="${escapeHtml(run.task_id)}">View</button></td>
      </tr>
    `;
  }).join('');

  reportRunsBody.querySelectorAll('.report-view-btn').forEach((button) => {
    button.addEventListener('click', () => {
      toggleReportDetail(button.dataset.taskId);
    });
  });
}

function toggleReportDetail(taskId) {
  if (!reportDetail) return;
  if (selectedReportTaskId === taskId && !reportDetail.classList.contains('hidden')) {
    selectedReportTaskId = null;
    reportDetail.classList.add('hidden');
    reportDetail.innerHTML = '';
    return;
  }

  const run = reportRuns.find((item) => item.task_id === taskId);
  if (!run) return;
  selectedReportTaskId = taskId;
  const status = getReportRunStatus(run);
  const durationMs = getReportRunDurationMs(run);
  const detailItems = [
    ['Task ID', run.task_id],
    ['Agent', getReportText(run, 'agent_id', run.device_id || '--')],
    ['Device Serial', getReportText(run, 'device_serial', run.device_id || '--')],
    ['Software Version', getReportText(run, 'software_version')],
    ['Script Version', getReportText(run, 'script_version')],
    ['Script', run.script_name || '--'],
    ['Started At', formatTimestamp(run.started_at)],
    ['Duration', durationMs === null ? '--:--' : formatDuration(durationMs)],
    ['Status', status],
  ];
  const statRows = Object.entries(run.stats || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `
      <tr>
        <td class="report-mono">${escapeHtml(key)}</td>
        <td>${escapeHtml(formatStatValue(entry?.value))}</td>
        <td>${escapeHtml(entry?.type || '')}</td>
        <td>${escapeHtml(formatTimestamp(entry?.updatedAt))}</td>
      </tr>
    `).join('');

  reportDetail.innerHTML = `
    <h3>Task ${escapeHtml(run.task_id)}</h3>
    <div class="report-detail-grid">
      ${detailItems.map(([label, value]) => `
        <div class="stat-tile">
          <span class="stat-label">${escapeHtml(label)}</span>
          <strong class="stat-value">${escapeHtml(value)}</strong>
        </div>
      `).join('')}
    </div>
    <table class="report-detail-table">
      <thead>
        <tr>
          <th>Stat</th>
          <th>Value</th>
          <th>Type</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>${statRows || '<tr><td colspan="4" class="report-empty">No stats.</td></tr>'}</tbody>
    </table>
  `;
  reportDetail.classList.remove('hidden');
}

async function loadReportOptions() {
  if (!authToken) return;
  try {
    const data = await apiRequest('/api/reports/options');
    const options = data.options || {};
    populateReportSelect(reportAgentSelect, options.agents, 'All agents');
    populateReportSelect(reportDeviceSelect, options.devices, 'All devices');
    populateReportSelect(reportScriptSelect, options.scripts, 'All scripts');
    populateReportSelect(reportSoftwareSelect, options.softwareVersions, 'All versions');
    populateReportSelect(reportStatusSelect, options.statuses, 'All statuses');
  } catch (err) {
    console.warn('Failed to load report options:', err);
  }
}

async function loadReports() {
  if (!authToken || !reportRunsBody) return;
  setReportStatus('Loading reports...');
  try {
    const data = await apiRequest(`/api/reports/task-summary${buildReportQuery()}`);
    reportRuns = data.runs || [];
    selectedReportTaskId = null;
    renderReportSummary(data.summary || {});
    renderReportTable();
    if (reportDetail) {
      reportDetail.classList.add('hidden');
      reportDetail.innerHTML = '';
    }
    setReportStatus(data.dbReady ? `Showing latest ${reportRuns.length} task runs.` : 'Database is not ready.');
  } catch (err) {
    console.warn('Failed to load reports:', err);
    reportRuns = [];
    renderReportSummary({});
    renderReportTable();
    setReportStatus('Failed to load reports.', true);
  }
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
  processStatLines(deviceId, text);
  appendAirtestLog(`[${deviceId}] ${text}${suffix}`);
}

function handleAirtestTaskResult(msg) {
  const deviceId = resolveTaskDeviceId(msg);
  const prefix = deviceId ? `[${deviceId}][${msg.task_id}]` : `[${msg.task_id}]`;
  finishAirtestStats(deviceId, msg.task_id, msg.status);
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
  loadReportOptions();
  loadReports();
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

// ======== 重整後恢復任務狀態 ========
function handleRestoreTasks(tasks) {
  if (!tasks || !tasks.length) return;
  appendAirtestLog(`\n[System] 🔄 恢復 ${tasks.length} 個執行中任務...\n`);

  tasks.forEach((run) => {
    const deviceId = run.device_id;
    const taskId = run.task_id;
    const scriptName = run.script_name || '--';
    // 用 DB 記錄的 started_at 還原真實開始時間，計時器才會從正確的位置繼續
    const startedAt = run.started_at ? new Date(run.started_at).getTime() : Date.now();

    if (!deviceId || !taskId) return;

    // 恢復 activeTasks（讓 Run/Stop 按鈕狀態正確）
    if (!activeTasks[deviceId]) {
      setDeviceTask(deviceId, taskId, 'running');
    }
    taskDeviceIndex[taskId] = deviceId;

    // 恢復 airtestStatsState（讓計時器、狀態列正確顯示）
    airtestStatsState.lastDeviceId = deviceId;
    if (!airtestStatsState.byDevice[deviceId]) {
      airtestStatsState.byDevice[deviceId] = { current: null, last: null, custom: {} };
    }
    const ds = airtestStatsState.byDevice[deviceId];
    ds.current = {
      taskId,
      scriptName,
      status: 'running',
      startedAt,   // ← 關鍵：從 DB 時間反推，不從 Date.now() 開始
      endedAt: null,
    };
    ds.last = ds.current;

    // 恢復客製化統計數據（[STAT] 已累積在 DB 裡的值）
    if (run.statsMap && typeof run.statsMap === 'object') {
      for (const [key, entry] of Object.entries(run.statsMap)) {
        ds.custom[key] = entry;
      }
    }

    appendAirtestLog(`[System] ✅ [${deviceId}][${taskId}] 已恢復，腳本: ${scriptName}\n`);
  });

  // 恢復執行次數計數（只計不重複的 taskId）
  tasks.forEach((run) => {
    const taskKey = `${run.device_id}:${run.task_id}`;
    if (!airtestStatsState.completedTasks.has(taskKey)) {
      airtestStatsState.totals.runs = Math.max(airtestStatsState.totals.runs, tasks.length);
    }
  });

  renderAirtestStats();
  ensureAirtestStatsTimer();
}

// ======== stdin 互動 ========
function handleInputPrompt(msg) {
  const prompt = msg.prompt || '';
  _pendingStdinDeviceId = msg.deviceId || null;
  _pendingStdinTaskId = msg.task_id || null;

  stdinPromptLabel.textContent = prompt ? `${prompt} ` : '請輸入: ';
  stdinInputField.value = '';
  if (stdinInputArea) stdinInputArea.classList.remove('hidden');
  stdinInputField.focus();
  appendAirtestLog(`\n[System][等待輸入] ${prompt}\n`);
}

function hideStdinInput() {
  if (stdinInputArea) stdinInputArea.classList.add('hidden');
  _pendingStdinDeviceId = null;
  _pendingStdinTaskId = null;
}

function sendStdinInput() {
  const value = stdinInputField.value;
  if (!_pendingStdinDeviceId || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'stdin_input',
    deviceId: _pendingStdinDeviceId,
    task_id: _pendingStdinTaskId,
    input: value,
  }));
  appendAirtestLog(`[${_pendingStdinDeviceId}] > ${value}\n`);
  hideStdinInput();
}

if (stdinSendBtn) stdinSendBtn.addEventListener('click', sendStdinInput);
if (stdinInputField) stdinInputField.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendStdinInput(); });

if (loginButton) loginButton.addEventListener('click', login);
if (passwordInput) passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
if (logoutButton) logoutButton.addEventListener('click', logout);
if (airtestLogsClearBtn) airtestLogsClearBtn.addEventListener('click', clearAirtestLogs);
if (airtestStatsResetBtn) airtestStatsResetBtn.addEventListener('click', resetAirtestStats);
if (reportRefreshBtn) {
  reportRefreshBtn.addEventListener('click', () => {
    loadReportOptions();
    loadReports();
  });
}
[reportFromDate, reportToDate, reportAgentSelect, reportDeviceSelect, reportScriptSelect, reportSoftwareSelect, reportStatusSelect]
  .filter(Boolean)
  .forEach((control) => control.addEventListener('change', loadReports));

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

  renderAirtestStats();
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
