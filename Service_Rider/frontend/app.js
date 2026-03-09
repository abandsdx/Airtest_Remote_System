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
const terminalOutput = document.getElementById('terminalOutput');
const terminalInput = document.getElementById('terminalInput');
const terminalSendBtn = document.getElementById('terminalSendBtn');
const terminalClearBtn = document.getElementById('terminalClearBtn');
const ttsInput = document.getElementById('ttsInput');
const ttsSendBtn = document.getElementById('ttsSendBtn');
const ttsMicBtn = document.getElementById('ttsMicBtn');
const userManagementLink = document.getElementById('userManagementLink');
const viewerTitle = document.getElementById('viewerTitle');
const streamOverlay = document.getElementById('streamOverlay');
// const viewerHint = document.getElementById('viewerHint'); // Replaced by streamOverlay

function updateStreamOverlay(state, text = '') {
  if (!streamOverlay) return;

  const iconEl = streamOverlay.querySelector('.overlay-icon');
  const textEl = streamOverlay.querySelector('.overlay-text');

  streamOverlay.classList.remove('active', 'connecting', 'offline');

  if (state === 'hidden') {
    return;
  }

  streamOverlay.classList.add('active');
  if (textEl) textEl.textContent = text;

  if (state === 'connecting') {
    streamOverlay.classList.add('connecting');
    if (iconEl) iconEl.textContent = ''; // Spinner is CSS border
  } else if (state === 'offline') {
    streamOverlay.classList.add('offline');
    if (iconEl) iconEl.textContent = '⚠';
  } else if (state === 'paused' || state === 'initial') {
    if (iconEl) iconEl.textContent = '▶';
  }
}
const toggleAudioButton = document.getElementById('toggleAudio');
const startAllButton = document.getElementById('startAll');
const stopAllButton = document.getElementById('stopAll');
const screenCanvas = document.getElementById('screenCanvas');
const cameraCanvas = document.getElementById('cameraCanvas');
const viewerBody = document.getElementById('viewerBody');
const layoutSplitButton = document.getElementById('layoutSplit');
const layoutStackButton = document.getElementById('layoutStack');
const layoutPipButton = document.getElementById('layoutPip');
const controls = document.querySelectorAll('.controls button');

const fileBrowserCard = document.getElementById('fileBrowserCard');
const fileBackBtn = document.getElementById('fileBackBtn');
const filePathInput = document.getElementById('filePath');
const fileGoBtn = document.getElementById('fileGoBtn');
const fileRefreshBtn = document.getElementById('fileRefreshBtn');
const fileListContainer = document.getElementById('fileListContainer');
const fileError = document.getElementById('fileError');
const fileLoading = document.getElementById('fileLoading');
const fileUploadBtn = document.getElementById('fileUploadBtn');
const fileUploadInput = document.getElementById('fileUploadInput');
const fileProgress = document.getElementById('fileProgress');
const deleteModal = document.getElementById('deleteModal');
const deleteModalText = document.getElementById('deleteModalText');
const deleteCancelBtn = document.getElementById('deleteCancelBtn');
const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');
const fileBatchBar = document.getElementById('fileBatchBar');
const fileSelectAll = document.getElementById('fileSelectAll');
const fileBatchCount = document.getElementById('fileBatchCount');
const batchDownloadBtn = document.getElementById('batchDownloadBtn');
const batchDeleteBtn = document.getElementById('batchDeleteBtn');

const DEFAULT_SERVER_URL = 'https://fleetmind.duckdns.org';
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
const UPLOAD_CHUNK_DELAY_MS = 50;
const BATCH_DELETE_DELAY_MS = 300;
const MAX_AUDIO_QUEUE_SIZE = 100;
const wsStatusEl = document.getElementById('wsStatus');
const reconnectBanner = document.getElementById('reconnectBanner');

let currentDeviceId = null;
let currentUser = null;
let currentFilePath = '/';
let currentFileParentPath = '/';

let activeStream = 'screen';
const streamConfigs = { screen: null, camera: null };
const decoders = { screen: null, camera: null };
const streamStates = {
  screen: { needsKeyframe: true, configKey: null },
  camera: { needsKeyframe: true, configKey: null },
};
const FALLBACK_CODEC = 'avc1.42e01e';
let audioConfig = null;
let audioEnabled = false;
let audioContext = null;
let audioNode = null;
let audioQueue = [];
let audioQueueOffset = 0;

const STORAGE_TOKEN_KEY = 'riderAuthToken';
const STORAGE_URL_KEY = 'riderServerUrl';

usernameInput.value = localStorage.getItem('riderUsername') || 'admin';
if (serverUrlInput) {
  serverUrlInput.value = localStorage.getItem(STORAGE_URL_KEY) || DEFAULT_SERVER_URL;
}

function resolveApiBase() {
  const stored = localStorage.getItem(STORAGE_URL_KEY);
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
  if (!serverUrlStatus) {
    return;
  }
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
  if (!userManagementLink) {
    return;
  }
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
  audioEnabled = false;
  audioQueue = [];
  audioQueueOffset = 0;
  if (audioContext) {
    audioContext.close();
    audioContext = null;
    audioNode = null;
  }
  toggleAudioButton.textContent = 'Mic Off';
  toggleAudioButton.classList.add('ghost');
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
    if (device.deviceId === 'local-test' || device.name === 'local-test') {
      return;
    }
    if (!device.online) {
      return;
    }
    if (!device.model) {
      return;
    }
    const card = document.createElement('div');
    const selected = currentDeviceId === device.deviceId;
    card.className = `device-card ${device.online ? 'online' : ''} ${selected ? 'selected' : ''}`.trim();

    const displayName = device.name || device.deviceId;
    const modelInfo = device.model || 'Unknown';
    const safeDisplayName = escapeHtml(displayName);
    const safeModelInfo = escapeHtml(modelInfo);

    // Status indicators
    const streamIcon = device.streaming ? '<i class="fas fa-video text-success" title="Streaming"></i>' : '<i class="fas fa-video-slash" title="Idle"></i>';
    const micIcon = device.mic ? '<i class="fas fa-microphone text-success" title="Mic On"></i>' : '<i class="fas fa-microphone-slash" title="Mic Off"></i>';
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
        ${statusText} &nbsp; ${streamIcon} &nbsp; ${micIcon}
      </div>
    `;

    card.addEventListener('click', () => watchDevice(device.deviceId));
    deviceList.appendChild(card);
  });
}

function updateScreenHintForDevice(device) {
  if (!device) {
    return;
  }

  if (!device.online) {
    updateStreamOverlay('offline', 'Device Offline');
    return;
  }

  if (!device.streaming) {
    updateStreamOverlay('paused', 'Screen is off. Tap Grant Screen Permission on device.');
    return;
  }

  if (!streamConfigs.screen) {
    updateStreamOverlay('connecting', 'Waiting for screen stream...');
  } else if (activeStream === 'screen') {
    updateStreamOverlay('hidden');
  }
}



function setWsStatus(status) {
  if (wsStatusEl) {
    wsStatusEl.className = `ws-status ${status}`;
    wsStatusEl.title = `WebSocket ${status}`;
  }
  if (reconnectBanner) {
    reconnectBanner.classList.toggle('visible', status === 'reconnecting');
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
    if (reconnectBanner) {
      reconnectBanner.textContent = '⚠ Connection lost. Please refresh the page.';
      reconnectBanner.classList.add('visible');
    }
    return;
  }

  setWsStatus('reconnecting');
  // 使用指數退避策略,但有上限
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

    // Re-watch current device if we were watching one
    if (currentDeviceId) {
      ws.send(JSON.stringify({ type: 'watch', deviceId: currentDeviceId }));
    }
  });

  ws.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      handleTextMessage(event.data);
      return;
    }

    handleBinaryMessage(event.data);
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
    if (message.device.deviceId === currentDeviceId) {
      if (!message.device.online) {
        updateStreamOverlay('offline', 'Device Offline');
      } else if (message.device.streaming) {
        updateStreamOverlay('hidden');
      } else {
        updateStreamOverlay('paused', 'Stream Paused');
      }
    }
    renderDevices();
    return;
  }

  if (message.type === 'shell_result') {
    appendTerminalOutput(message.output);
    return;
  }

  if (message.type === 'recording-started') {
    return;
  }

  if (message.type === 'file_list_result') {
    handleFileListResult(message);
    return;
  }

  if (message.type === 'file_delete_result') {
    handleFileDeleteResult(message);
    return;
  }

  if (message.type === 'file_download_start') {
    handleFileDownloadStart(message);
    return;
  }

  if (message.type === 'file_download_chunk') {
    handleFileDownloadChunk(message);
    return;
  }

  if (message.type === 'file_download_complete') {
    handleFileDownloadComplete(message);
    return;
  }

  if (message.type === 'file_upload_result') {
    handleFileUploadResult(message);
    return;
  }

  if (message.type === 'recording-stopped') {
    return;
  }

  if (message.type === 'watch-failed') {
    updateStreamOverlay('offline', 'Device Offline');
  }

  // --- Airtest Events ---
  if (message.type === 'log') {
    appendAirtestLog(message.message || message.text);
    return;
  }

  if (message.type === 'task_result') {
    handleAirtestTaskResult(message);
    return;
  }
}

function handleBinaryMessage(buffer) {
  const view = new DataView(buffer);
  const type = view.getUint8(0);

  if (type === 1) {
    parseVideoConfig('screen', view, buffer);
    return;
  }

  if (type === 2) {
    decodeVideoFrame('screen', view, buffer);
    return;
  }

  if (type === 3) {
    parseVideoConfig('camera', view, buffer);
    return;
  }

  if (type === 4) {
    decodeVideoFrame('camera', view, buffer);
    return;
  }

  if (type === 5) {
    parseAudioConfig(view);
    return;
  }

  if (type === 6) {
    handleAudioFrame(view, buffer);
  }
}

function parseVideoConfig(streamKey, view, buffer) {
  let offset = 1;
  const codecId = view.getUint32(offset);
  offset += 4;
  const width = view.getUint32(offset);
  offset += 4;
  const height = view.getUint32(offset);
  offset += 4;
  const spsLength = view.getUint16(offset);
  offset += 2;
  const ppsLength = view.getUint16(offset);
  offset += 2;
  const sps = new Uint8Array(buffer, offset, spsLength);
  offset += spsLength;
  const pps = new Uint8Array(buffer, offset, ppsLength);

  streamConfigs[streamKey] = { codecId, width, height, sps, pps };
  streamStates[streamKey].needsKeyframe = true;
  configureDecoder(streamKey);
  const target = getCanvasForStream(streamKey);
  target.width = width;
  target.height = height;
  target.style.setProperty('--stream-aspect', `${width} / ${height}`);
  if (streamKey === activeStream) {
    updateStreamOverlay('hidden');
  }
}

function configureDecoder(streamKey) {
  const streamConfig = streamConfigs[streamKey];
  if (!streamConfig) {
    return;
  }

  if (!window.isSecureContext || !window.VideoDecoder) {
    updateStreamOverlay('paused', 'HTTPS Required for VideoDecoder');
    return;
  }

  const configKey = `${streamConfig.codecId}:${streamConfig.width}x${streamConfig.height}:${streamConfig.sps.length}:${streamConfig.pps.length}`;
  if (decoders[streamKey] && decoders[streamKey].state !== 'closed') {
    if (streamStates[streamKey].configKey === configKey) {
      return;
    }
    decoders[streamKey].close();
    decoders[streamKey] = null;
  }
  streamStates[streamKey].configKey = configKey;

  if (decoders[streamKey]) {
    if (decoders[streamKey].state !== 'closed') {
      decoders[streamKey].close();
    }
    decoders[streamKey] = null;
  }
  streamStates[streamKey].needsKeyframe = true;

  const sps = stripStartCode(streamConfig.sps);
  const pps = stripStartCode(streamConfig.pps);
  const codec = buildCodecString(sps);
  const description = buildAvcc(sps, pps);

  decoders[streamKey] = new VideoDecoder({
    output: (frame) => {
      const target = getCanvasForStream(streamKey);
      const ctx = target.getContext('2d');
      ctx.drawImage(frame, 0, 0, target.width, target.height);
      frame.close();
    },
    error: (err) => handleDecoderError(streamKey, err),
  });

  const config = {
    codec,
    codedWidth: streamConfig.width,
    codedHeight: streamConfig.height,
    description,
  };

  try {
    decoders[streamKey].configure(config);
  } catch (err) {
    if (codec !== FALLBACK_CODEC) {
      try {
        decoders[streamKey].configure({ ...config, codec: FALLBACK_CODEC });
      } catch (fallbackErr) {
        console.error(fallbackErr);
        updateStreamOverlay('paused', 'Decoder Error');
        decoders[streamKey].close();
        decoders[streamKey] = null;
      }
    } else {
      console.error(err);
      updateStreamOverlay('paused', 'Decoder Error');
      decoders[streamKey].close();
      decoders[streamKey] = null;
    }
  }
}

function decodeVideoFrame(streamKey, view, buffer) {
  const decoder = decoders[streamKey];
  if (!decoder || decoder.state === 'closed') {
    return;
  }
  if (!streamConfigs[streamKey]) {
    return;
  }

  const ptsAndFlags = view.getBigUint64(1, false);
  const size = view.getUint32(9, false);
  const start = 13;
  const end = start + size;
  if (end > buffer.byteLength) {
    return;
  }
  const payload = new Uint8Array(buffer, start, size);
  const keyFlag = (ptsAndFlags & (1n << 62n)) !== 0n;
  const pts = Number(ptsAndFlags & ((1n << 62n) - 1n));

  if (!keyFlag && streamStates[streamKey].needsKeyframe) {
    return;
  }
  if (keyFlag) {
    streamStates[streamKey].needsKeyframe = false;
  }

  const chunk = new EncodedVideoChunk({
    type: keyFlag ? 'key' : 'delta',
    timestamp: pts,
    data: convertAnnexBToAvcc(payload),
  });

  try {
    decoder.decode(chunk);
  } catch (err) {
    handleDecoderError(streamKey, err);
  }
}

function handleDecoderError(streamKey, err) {
  console.error(err);
  const decoder = decoders[streamKey];
  if (decoder && decoder.state !== 'closed') {
    decoder.close();
  }
  decoders[streamKey] = null;
  streamStates[streamKey].needsKeyframe = true;
  if (streamConfigs[streamKey]) {
    configureDecoder(streamKey);
  }
}

function parseAudioConfig(view) {
  const sampleRate = view.getUint32(1);
  const channels = view.getUint16(5);
  const bitsPerSample = view.getUint16(7);
  audioConfig = { sampleRate, channels, bitsPerSample };
  if (audioEnabled) {
    ensureAudioContext();
  }
}

function handleAudioFrame(view, buffer) {
  if (!audioEnabled || !audioConfig) {
    return;
  }
  if (audioConfig.bitsPerSample !== 16) {
    return;
  }
  const size = view.getUint32(9, false);
  const start = 13;
  const end = start + size;
  if (end > buffer.byteLength) {
    return;
  }
  const payload = new Uint8Array(buffer, start, size);
  enqueueAudio(payload);
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = audioConfig ? new AudioContext({ sampleRate: audioConfig.sampleRate }) : new AudioContext();
  }
  if (!audioNode) {
    audioNode = audioContext.createScriptProcessor(4096, 1, 1);
    audioNode.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      let offset = 0;
      while (offset < output.length) {
        if (audioQueue.length === 0) {
          output.fill(0, offset);
          break;
        }
        const chunk = audioQueue[0];
        const available = chunk.length - audioQueueOffset;
        const toCopy = Math.min(available, output.length - offset);
        output.set(chunk.subarray(audioQueueOffset, audioQueueOffset + toCopy), offset);
        offset += toCopy;
        audioQueueOffset += toCopy;
        if (audioQueueOffset >= chunk.length) {
          audioQueue.shift();
          audioQueueOffset = 0;
        }
      }
    };
    audioNode.connect(audioContext.destination);
  }
  audioContext.resume();
}

function enqueueAudio(payload) {
  let aligned = payload;
  if (aligned.byteOffset % 2 !== 0 || aligned.byteLength % 2 !== 0) {
    const trimmed = aligned.byteLength - (aligned.byteLength % 2);
    if (trimmed <= 0) {
      return;
    }
    const copy = new Uint8Array(trimmed);
    copy.set(aligned.subarray(0, trimmed));
    aligned = copy;
  }
  const samples = new Int16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2);
  const floats = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    floats[i] = samples[i] / 32768;
  }
  audioQueue.push(floats);

  // 防止記憶體洩漏:限制隊列大小
  if (audioQueue.length > MAX_AUDIO_QUEUE_SIZE) {
    audioQueue.shift();
  }
}

function stripStartCode(data) {
  if (data.length >= 4 && data[0] === 0x00 && data[1] === 0x00) {
    if (data[2] === 0x01) {
      return data.slice(3);
    }
    if (data[2] === 0x00 && data[3] === 0x01) {
      return data.slice(4);
    }
  }
  return data;
}

function buildCodecString(sps) {
  if (sps.length < 4) {
    return FALLBACK_CODEC;
  }
  const profile = sps[1].toString(16).padStart(2, '0');
  const compat = sps[2].toString(16).padStart(2, '0');
  const level = sps[3].toString(16).padStart(2, '0');
  return `avc1.${profile}${compat}${level}`;
}

function buildAvcc(sps, pps) {
  const spsLength = sps.length;
  const ppsLength = pps.length;
  const total = 7 + 2 + spsLength + 1 + 2 + ppsLength;
  const avcc = new Uint8Array(total);

  let offset = 0;
  avcc[offset++] = 0x01;
  avcc[offset++] = sps[1];
  avcc[offset++] = sps[2];
  avcc[offset++] = sps[3];
  avcc[offset++] = 0xfc | 0x03;
  avcc[offset++] = 0xe0 | 0x01;
  avcc[offset++] = (spsLength >> 8) & 0xff;
  avcc[offset++] = spsLength & 0xff;
  avcc.set(sps, offset);
  offset += spsLength;
  avcc[offset++] = 0x01;
  avcc[offset++] = (ppsLength >> 8) & 0xff;
  avcc[offset++] = ppsLength & 0xff;
  avcc.set(pps, offset);
  return avcc;
}

function convertAnnexBToAvcc(payload) {
  if (payload.length < 4) {
    return payload;
  }

  const hasStartCode =
    (payload[0] === 0x00 && payload[1] === 0x00 && payload[2] === 0x01) ||
    (payload[0] === 0x00 && payload[1] === 0x00 && payload[2] === 0x00 && payload[3] === 0x01);
  if (!hasStartCode) {
    return payload;
  }

  const units = [];
  let index = 0;
  let nalStart = -1;

  const pushUnit = (end) => {
    if (nalStart >= 0 && end > nalStart) {
      units.push(payload.subarray(nalStart, end));
    }
  };

  while (index <= payload.length - 3) {
    let startCodeLength = 0;
    if (
      index <= payload.length - 4 &&
      payload[index] === 0x00 &&
      payload[index + 1] === 0x00 &&
      payload[index + 2] === 0x00 &&
      payload[index + 3] === 0x01
    ) {
      startCodeLength = 4;
    } else if (payload[index] === 0x00 && payload[index + 1] === 0x00 && payload[index + 2] === 0x01) {
      startCodeLength = 3;
    }

    if (startCodeLength > 0) {
      pushUnit(index);
      index += startCodeLength;
      nalStart = index;
      continue;
    }
    index += 1;
  }
  pushUnit(payload.length);

  if (units.length === 0) {
    return payload;
  }

  let total = 0;
  for (const unit of units) {
    total += 4 + unit.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const unit of units) {
    out[offset++] = (unit.length >>> 24) & 0xff;
    out[offset++] = (unit.length >>> 16) & 0xff;
    out[offset++] = (unit.length >>> 8) & 0xff;
    out[offset++] = unit.length & 0xff;
    out.set(unit, offset);
    offset += unit.length;
  }

  return out;
}

function setActiveStream(streamKey) {
  activeStream = streamKey;
  updateViewerTitle();
  if (viewerBody) {
    viewerBody.dataset.pipMain = streamKey;
  }
  const config = streamConfigs[streamKey];
  if (config) {
    const target = getCanvasForStream(streamKey);
    target.width = config.width;
    target.height = config.height;
    if (!decoders[streamKey] || decoders[streamKey].state === 'closed') {
      configureDecoder(streamKey);
    }
  } else {
    updateStreamOverlay('connecting', 'Waiting for stream...');
  }
}

function resetStreamsForDeviceSwitch() {
  Object.keys(streamConfigs).forEach((key) => {
    streamConfigs[key] = null;
    streamStates[key].needsKeyframe = true;
    const decoder = decoders[key];
    if (decoder && decoder.state !== 'closed') {
      decoder.close();
    }
    decoders[key] = null;
  });
  audioQueue = [];
  audioQueueOffset = 0;
  audioConfig = null;
}

async function watchDevice(deviceId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  if (currentDeviceId && currentDeviceId !== deviceId) {
    ws.send(JSON.stringify({ type: 'unwatch' }));
  }

  currentDeviceId = deviceId;
  renderDevices();
  resetStreamsForDeviceSwitch();
  setActiveStream(activeStream);
  updateStreamOverlay('connecting', 'Waiting for stream...');
  updateScreenHintForDevice(devices.find((device) => device.deviceId === deviceId));
  ws.send(JSON.stringify({ type: 'watch', deviceId }));
  sendService('request_keyframe');

  // Initialize file browser
  if (fileBrowserCard) {
    fileBrowserCard.classList.add('active');
    currentFilePath = '/';
    if (filePathInput) filePathInput.value = currentFilePath;
    requestFileList(currentFilePath);
  }
}

function getDeviceDisplayName(deviceId) {
  const device = devices.find((item) => item.deviceId === deviceId);
  return device?.name || deviceId;
}

function updateViewerTitle() {
  const displayName = currentDeviceId ? getDeviceDisplayName(currentDeviceId) : '';
  viewerTitle.textContent = currentDeviceId ? `Live View: ${displayName}` : 'Live View';
}

function getCanvasForStream(streamKey) {
  return streamKey === 'camera' ? cameraCanvas : screenCanvas;
}

function setLayoutMode(mode) {
  viewerBody.classList.remove('mode-split', 'mode-stack', 'mode-pip');
  viewerBody.classList.add(`mode-${mode}`);
  layoutSplitButton.classList.toggle('ghost', mode !== 'split');
  layoutStackButton.classList.toggle('ghost', mode !== 'stack');
  layoutPipButton.classList.toggle('ghost', mode !== 'pip');
}

function sendControl(action, payload = {}) {
  if (!currentDeviceId || !ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(
    JSON.stringify({
      type: 'control',
      deviceId: currentDeviceId,
      action,
      ...payload,
    })
  );
}

function sendService(action, payload = {}) {
  if (!currentDeviceId || !ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(
    JSON.stringify({
      type: 'service',
      deviceId: currentDeviceId,
      action,
      ...payload,
    })
  );
}

function handleCanvasGesture() {
  let start = null;

  screenCanvas.addEventListener('pointerdown', (event) => {
    start = { x: event.offsetX, y: event.offsetY, time: Date.now() };
  });

  screenCanvas.addEventListener('pointerup', (event) => {
    if (!start) {
      return;
    }
    const end = { x: event.offsetX, y: event.offsetY, time: Date.now() };
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const duration = end.time - start.time;

    const rect = screenCanvas.getBoundingClientRect();
    const norm = (point) => ({
      x: Math.max(0, Math.min(1, point.x / rect.width)),
      y: Math.max(0, Math.min(1, point.y / rect.height)),
    });

    if (dx < 10 && dy < 10) {
      const point = norm(start);
      sendControl('tap', { x: point.x, y: point.y });
    } else {
      const from = norm(start);
      const to = norm(end);
      sendControl('swipe', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, durationMs: Math.max(100, duration) });
    }

    start = null;
  });
}

loginButton.addEventListener('click', login);
logoutButton.addEventListener('click', logout);
function appendTerminalOutput(text) {
  if (!text) return;
  terminalOutput.textContent += text;
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function sendShellCommand() {
  const cmd = terminalInput.value.trim();
  if (!cmd) return;

  if (!currentDeviceId) {
    appendTerminalOutput('Error: No device selected.\n');
    return;
  }

  if (cmd === 'clear' || cmd === 'cls') {
    clearTerminal();
    terminalInput.value = '';
    return;
  }

  appendTerminalOutput(`$ ${cmd}\n`);
  sendService('shell', { cmd });
  terminalInput.value = '';
}

function sendTTS() {
  const text = ttsInput?.value?.trim();
  if (!text) return;

  if (!currentDeviceId) {
    appendTerminalOutput('Error: No device selected for TTS.\n');
    return;
  }

  sendService('tts', { text });
  ttsInput.value = '';
}

function clearTerminal() {
  if (terminalOutput) {
    terminalOutput.innerHTML = '';
  }
}

if (terminalSendBtn) {
  terminalSendBtn.addEventListener('click', sendShellCommand);
}

if (terminalClearBtn) {
  terminalClearBtn.addEventListener('click', clearTerminal);
}

if (terminalInput) {
  terminalInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendShellCommand();
    }
  });
}

if (ttsSendBtn) {
  ttsSendBtn.addEventListener('click', sendTTS);
}

// Voice Input Logic
let recognition = null;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'cmn-Hant-TW'; // Default to Traditional Chinese

  recognition.onstart = () => {
    if (ttsMicBtn) {
      ttsMicBtn.classList.remove('ghost');
      ttsMicBtn.classList.add('recording');
      ttsInput.placeholder = 'Listening...';
    }
  };

  recognition.onend = () => {
    if (ttsMicBtn) {
      ttsMicBtn.classList.add('ghost');
      ttsMicBtn.classList.remove('recording');
      ttsInput.placeholder = 'Speak text (e.g. Hello Robot)...';
    }
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (ttsInput) {
      ttsInput.value = transcript;
    }
  };

  recognition.onerror = (event) => {
    // Handle different error types
    if (event.error === 'no-speech') {
      // User didn't speak - this is not really an error, just reset UI
      if (ttsInput) {
        ttsInput.placeholder = 'No speech detected. Try again...';
        setTimeout(() => {
          ttsInput.placeholder = 'Speak text (e.g. Hello Robot)...';
        }, 2000);
      }
    } else if (event.error === 'aborted') {
      // Recognition was aborted - silent handling
    } else if (event.error === 'not-allowed') {
      console.warn('Microphone permission denied');
      if (ttsInput) {
        ttsInput.placeholder = 'Microphone access denied';
      }
    } else {
      // Log other errors for debugging
      console.error('Speech recognition error:', event.error);
    }

    if (ttsMicBtn) {
      ttsMicBtn.classList.add('ghost');
      ttsMicBtn.classList.remove('recording');
    }
  };
} else {
  console.warn('Speech Recognition API not supported in this browser.');
  if (ttsMicBtn) {
    ttsMicBtn.style.display = 'none';
  }
}

if (ttsMicBtn) {
  ttsMicBtn.addEventListener('click', () => {
    if (recognition) {
      try {
        recognition.start();
      } catch (e) {
        recognition.stop();
      }
    } else {
      alert('Voice input is not supported in this browser.');
    }
  });
}

if (ttsInput) {
  ttsInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendTTS();
    }
  });
}

function toggleServerSettings() {
  if (!serverUrlPanel) {
    return;
  }
  serverUrlPanel.classList.toggle('hidden');
  if (!serverUrlPanel.classList.contains('hidden') && serverUrlInput) {
    serverUrlInput.value = localStorage.getItem(STORAGE_URL_KEY) || DEFAULT_SERVER_URL;
    setServerUrlStatus('');
    serverUrlInput.focus();
  }
}

saveServerUrlButton?.addEventListener('click', () => {
  if (!serverUrlInput) {
    return;
  }
  const nextValue = sanitizeServerUrl(serverUrlInput.value);
  if (!nextValue) {
    setServerUrlStatus('Server URL is required.', true);
    return;
  }
  localStorage.setItem(STORAGE_URL_KEY, nextValue);
  serverUrlInput.value = nextValue;
  setServerUrlStatus('Server URL saved.');
});

resetServerUrlButton?.addEventListener('click', () => {
  localStorage.setItem(STORAGE_URL_KEY, DEFAULT_SERVER_URL);
  if (serverUrlInput) {
    serverUrlInput.value = DEFAULT_SERVER_URL;
  }
  setServerUrlStatus('Reset to default.');
});

loginTitle?.addEventListener('dblclick', toggleServerSettings);
document.addEventListener('keydown', (event) => {
  if (loginView.classList.contains('hidden')) {
    return;
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'u') {
    event.preventDefault();
    toggleServerSettings();
  }
});

controls.forEach((button) => {
  button.addEventListener('click', () => {
    sendControl('key', { key: button.dataset.action });
  });
});

layoutSplitButton.addEventListener('click', () => setLayoutMode('split'));
layoutStackButton.addEventListener('click', () => setLayoutMode('stack'));
layoutPipButton.addEventListener('click', () => setLayoutMode('pip'));
toggleAudioButton.addEventListener('click', () => {
  audioEnabled = !audioEnabled;
  toggleAudioButton.textContent = audioEnabled ? 'Mic On' : 'Mic Off';
  toggleAudioButton.classList.toggle('ghost', !audioEnabled);
  if (audioEnabled) {
    ensureAudioContext();
  } else {
    audioQueue = [];
    audioQueueOffset = 0;
  }
});

startAllButton.addEventListener('click', () => {
  sendService('start_all');
  updateStreamOverlay('connecting', 'Connecting...');
});

stopAllButton.addEventListener('click', () => {
  sendService('stop_all');
  updateStreamOverlay('paused', 'Stream Paused');
});

if (streamOverlay) {
  streamOverlay.addEventListener('click', () => {
    // Retry/Start if paused or initial
    if (streamOverlay.classList.contains('active') && !streamOverlay.classList.contains('connecting')) {
      sendService('start_all');
      updateStreamOverlay('connecting', 'Connecting...');
    }
  });
}

handleCanvasGesture();
setActiveStream('screen');
setLayoutMode('split');
restoreSession();

/* File Browser Logic */

function requestFileList(path) {
  if (!currentDeviceId || !ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  if (fileLoading) fileLoading.classList.remove('hidden');
  if (fileError) fileError.classList.add('hidden');
  if (fileListContainer) fileListContainer.innerHTML = '';

  sendService('file_list', {
    path,
    requestId: Date.now().toString()
  });
}

function handleFileListResult(message) {
  if (fileLoading) fileLoading.classList.add('hidden');

  if (!message.success) {
    if (fileError) {
      fileError.textContent = message.error || 'Unknown error';
      fileError.classList.remove('hidden');
    }
    return;
  }

  currentFilePath = message.path;
  currentFileParentPath = message.parentPath || '/';
  if (filePathInput) filePathInput.value = currentFilePath;
  renderFileList(message.files || [], currentFileParentPath);
}

function renderFileList(files, parentPath) {
  if (!fileListContainer) return;
  fileListContainer.innerHTML = '';
  selectedFiles.clear();
  if (fileSelectAll) fileSelectAll.checked = false;
  updateBatchBar();

  if (files.length === 0) {
    fileListContainer.innerHTML = '<div class="file-empty">Folder is empty</div>';
    return;
  }

  currentFileList = files;

  files.forEach(file => {
    const item = document.createElement('div');
    item.className = `file-item ${file.isDirectory ? 'directory' : 'file'}`;

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'file-checkbox';
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        selectedFiles.add(file.path);
        item.classList.add('selected-item');
      } else {
        selectedFiles.delete(file.path);
        item.classList.remove('selected-item');
      }
      updateBatchBar();
    });

    // Icon
    const icon = document.createElement('div');
    icon.className = 'file-icon';
    icon.textContent = file.isDirectory ? '📁' : '📄';

    // Info
    const info = document.createElement('div');
    info.className = 'file-info';

    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = file.name;

    const meta = document.createElement('div');
    meta.className = 'file-meta';

    if (file.isDirectory) {
      meta.textContent = new Date(file.lastModified).toLocaleString();
    } else {
      meta.textContent = `${formatFileSize(file.size)} · ${new Date(file.lastModified).toLocaleString()}`;
    }

    info.appendChild(name);
    info.appendChild(meta);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'file-actions';

    // Download button (files download directly, folders download as ZIP)
    const dlBtn = document.createElement('button');
    dlBtn.className = 'ghost';
    dlBtn.textContent = '⬇';
    dlBtn.title = file.isDirectory ? 'Download as ZIP' : 'Download';
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      requestFileDownload(file.path, file.name);
    });
    actions.appendChild(dlBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showDeleteConfirm(file.path, file.name, file.isDirectory);
    });
    actions.appendChild(delBtn);

    item.appendChild(checkbox);
    item.appendChild(icon);
    item.appendChild(info);
    item.appendChild(actions);

    // Directory navigation
    if (file.isDirectory) {
      item.addEventListener('click', () => {
        requestFileList(file.path);
      });
    }

    fileListContainer.appendChild(item);
  });
}

const selectedFiles = new Set();
let currentFileList = [];

function updateBatchBar() {
  const count = selectedFiles.size;
  if (fileBatchBar) {
    if (count > 0) {
      fileBatchBar.classList.remove('hidden');
    } else {
      fileBatchBar.classList.add('hidden');
    }
  }
  if (fileBatchCount) {
    fileBatchCount.textContent = `${count} selected`;
  }
  // Sync "select all" checkbox
  if (fileSelectAll && currentFileList.length > 0) {
    fileSelectAll.checked = count === currentFileList.length;
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// sendService 函數已在上方定義 (第983-995行),無需重複定義

// Event Listeners
if (fileGoBtn) {
  fileGoBtn.addEventListener('click', () => {
    if (filePathInput) {
      requestFileList(filePathInput.value);
    }
  });
}

if (fileRefreshBtn) {
  fileRefreshBtn.addEventListener('click', () => {
    requestFileList(currentFilePath);
  });
}

if (fileBackBtn) {
  fileBackBtn.addEventListener('click', () => {
    if (currentFilePath === '/' || currentFilePath === '') return;
    // Use server-provided parent path to avoid alias loops
    // (e.g., /storage/emulated/0 -> /storage instead of /storage/emulated)
    if (currentFileParentPath && currentFileParentPath !== currentFilePath) {
      requestFileList(currentFileParentPath);
    } else {
      const parts = currentFilePath.split('/').filter(p => p);
      parts.pop();
      const parent = parts.length === 0 ? '/' : '/' + parts.join('/');
      requestFileList(parent);
    }
  });
}

if (filePathInput) {
  filePathInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      requestFileList(filePathInput.value);
    }
  });
}

// ======== File Operations ========

let pendingDeletePath = null;
const downloadBuffers = new Map(); // requestId -> { fileName, totalChunks, chunks[] }

// --- Progress UI ---
function showProgress(label, percent) {
  if (!fileProgress) return;
  fileProgress.classList.remove('hidden');
  fileProgress.querySelector('.file-progress-label').textContent = label;
  fileProgress.querySelector('.file-progress-fill').style.width = `${percent}%`;
}

function hideProgress() {
  if (!fileProgress) return;
  fileProgress.classList.add('hidden');
}

// --- Delete ---
function showDeleteConfirm(path, name, isDir) {
  pendingDeletePath = path;
  if (deleteModalText) {
    deleteModalText.textContent = `Are you sure you want to delete ${isDir ? 'folder' : 'file'} "${name}"?${isDir ? ' (All contents will be deleted)' : ''}`;
  }
  if (deleteModal) deleteModal.classList.remove('hidden');
}

if (deleteCancelBtn) {
  deleteCancelBtn.addEventListener('click', () => {
    pendingDeletePath = null;
    pendingBatchDelete = [];
    if (deleteModal) deleteModal.classList.add('hidden');
  });
}

// Single delete confirm is handled by the unified handler in Batch Operations section below

function handleFileDeleteResult(message) {
  hideProgress();
  if (message.success) {
    requestFileList(currentFilePath); // Refresh
  } else {
    if (fileError) {
      fileError.textContent = `Delete failed: ${message.error || 'Unknown error'}`;
      fileError.classList.remove('hidden');
    }
  }
}

// --- Download ---
function requestFileDownload(path, fileName) {
  if (!currentDeviceId || !ws || ws.readyState !== WebSocket.OPEN) return;
  showProgress(`Downloading ${fileName}...`, 0);
  sendService('file_download', {
    path,
    requestId: Date.now().toString()
  });
}

function handleFileDownloadStart(message) {
  downloadBuffers.set(message.requestId, {
    fileName: message.fileName,
    fileSize: message.fileSize,
    totalChunks: message.totalChunks,
    chunks: new Array(message.totalChunks),
    received: 0
  });
  showProgress(`Downloading ${message.fileName}...`, 0);
}

function handleFileDownloadChunk(message) {
  const dl = downloadBuffers.get(message.requestId);
  if (!dl) return;
  dl.chunks[message.chunkIndex] = message.data;
  dl.received++;
  const percent = Math.round((dl.received / dl.totalChunks) * 100);
  showProgress(`Downloading ${dl.fileName}... (${percent}%)`, percent);
}

function handleFileDownloadComplete(message) {
  hideProgress();

  // 確保總是清理緩衝區,防止記憶體洩漏
  try {
    if (!message.success) {
      if (fileError) {
        fileError.textContent = `Download failed: ${message.error || 'Unknown error'}`;
        fileError.classList.remove('hidden');
      }
      return;
    }

    const dl = downloadBuffers.get(message.requestId);
    if (!dl) return;

    // Decode base64 chunks and create blob
    const byteArrays = [];
    for (const chunk of dl.chunks) {
      if (!chunk) continue;
      const binary = atob(chunk);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      byteArrays.push(bytes);
    }
    const blob = new Blob(byteArrays);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dl.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } finally {
    downloadBuffers.delete(message.requestId);
  }
}

// --- Upload ---
if (fileUploadBtn) {
  fileUploadBtn.addEventListener('click', () => {
    if (fileUploadInput) fileUploadInput.click();
  });
}

if (fileUploadInput) {
  fileUploadInput.addEventListener('change', async () => {
    const files = fileUploadInput.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
      await uploadFile(file);
    }
    fileUploadInput.value = '';

    // 添加延遲確保服務器處理完成,避免競態條件
    await new Promise(r => setTimeout(r, 500));
    requestFileList(currentFilePath);
  });
}

async function uploadFile(file) {
  if (!currentDeviceId || !ws || ws.readyState !== WebSocket.OPEN) return;

  const CHUNK_SIZE = 512 * 1024; // 512KB
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;
  const requestId = Date.now().toString();

  showProgress(`Uploading ${file.name}...`, 0);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const slice = file.slice(start, end);
    const base64 = await readAsBase64(slice);

    sendService('file_upload_chunk', {
      requestId,
      path: currentFilePath,
      fileName: file.name,
      data: base64,
      chunkIndex: i,
      totalChunks
    });

    const percent = Math.round(((i + 1) / totalChunks) * 100);
    showProgress(`Uploading ${file.name}... (${percent}%)`, percent);

    // Small delay to prevent flooding
    if (i < totalChunks - 1) {
      await new Promise(r => setTimeout(r, UPLOAD_CHUNK_DELAY_MS));
    }
  }
}

function readAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is "data:...;base64,XXXXX"
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function handleFileUploadResult(message) {
  hideProgress();
  if (message.success) {
    requestFileList(currentFilePath); // Refresh
  } else {
    if (fileError) {
      fileError.textContent = `Upload failed: ${message.error || 'Unknown error'}`;
      fileError.classList.remove('hidden');
    }
  }
}

// ======== Batch Operations ========

// Select All
if (fileSelectAll) {
  fileSelectAll.addEventListener('change', () => {
    const checkboxes = fileListContainer.querySelectorAll('.file-checkbox');
    if (fileSelectAll.checked) {
      currentFileList.forEach(f => selectedFiles.add(f.path));
      checkboxes.forEach(cb => { cb.checked = true; cb.closest('.file-item').classList.add('selected-item'); });
    } else {
      selectedFiles.clear();
      checkboxes.forEach(cb => { cb.checked = false; cb.closest('.file-item').classList.remove('selected-item'); });
    }
    updateBatchBar();
  });
}

// Batch Download
if (batchDownloadBtn) {
  batchDownloadBtn.addEventListener('click', () => {
    if (selectedFiles.size === 0) return;
    const paths = Array.from(selectedFiles);
    showProgress(`Preparing ${paths.length} items for download...`, 0);
    sendService('file_download_batch', {
      paths,
      requestId: Date.now().toString()
    });
  });
}

// Batch Delete
let pendingBatchDelete = [];

if (batchDeleteBtn) {
  batchDeleteBtn.addEventListener('click', () => {
    if (selectedFiles.size === 0) return;
    pendingBatchDelete = Array.from(selectedFiles);
    if (deleteModalText) {
      deleteModalText.textContent = `Are you sure you want to delete ${pendingBatchDelete.length} selected items?`;
    }
    // Temporarily swap delete confirm to batch mode
    pendingDeletePath = null;
    if (deleteModal) deleteModal.classList.remove('hidden');
  });
}

// Override delete confirm to handle batch
const origDeleteConfirmHandler = deleteConfirmBtn ? deleteConfirmBtn.onclick : null;
if (deleteConfirmBtn) {
  // Remove existing listener and add unified one
  const newDeleteConfirmBtn = deleteConfirmBtn.cloneNode(true);
  deleteConfirmBtn.parentNode.replaceChild(newDeleteConfirmBtn, deleteConfirmBtn);

  newDeleteConfirmBtn.addEventListener('click', () => {
    if (deleteModal) deleteModal.classList.add('hidden');

    if (pendingBatchDelete.length > 0) {
      // Batch delete mode
      const items = [...pendingBatchDelete];
      pendingBatchDelete = [];
      batchDeleteItems(items);
    } else if (pendingDeletePath) {
      // Single delete mode
      sendService('file_delete', {
        path: pendingDeletePath,
        requestId: Date.now().toString()
      });
      showProgress('Deleting...', 50);
      pendingDeletePath = null;
    }
  });
}

async function batchDeleteItems(paths) {
  showProgress(`Deleting ${paths.length} items...`, 0);
  let completed = 0;

  for (const path of paths) {
    sendService('file_delete', {
      path,
      requestId: Date.now().toString()
    });
    completed++;
    showProgress(`Deleting... (${completed}/${paths.length})`, Math.round((completed / paths.length) * 100));
    // Wait a bit between deletes to avoid flooding
    await new Promise(r => setTimeout(r, BATCH_DELETE_DELAY_MS));
  }
  // Final refresh will be triggered by handleFileDeleteResult
}

// Initializes UI Loading Animation
document.addEventListener('DOMContentLoaded', () => {
  const loadingOverlay = document.getElementById('loadingOverlay');

  // Simulate initialization delay for smooth experience
  setTimeout(() => {
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
      setTimeout(() => {
        loadingOverlay.style.display = 'none';
      }, 500); // Wait for transition to finish
    }
  }, 800);
});

// Enhance button interactions
document.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('mousedown', function () {
    this.style.transform = 'scale(0.96)';
  });
  btn.addEventListener('mouseup', function () {
    this.style.transform = 'scale(1)';
  });
  btn.addEventListener('mouseleave', function () {
    this.style.transform = '';
  });
});

// ======== Airtest Operations ========
const airtestUploadInput = document.getElementById('airtestUploadInput');
const airtestUploadBtn = document.getElementById('airtestUploadBtn');
const airtestScriptSelect = document.getElementById('airtestScriptSelect');
const airtestRefreshBtn = document.getElementById('airtestRefreshBtn');
const airtestVarsInput = document.getElementById('airtestVarsInput');
const airtestRunBtn = document.getElementById('airtestRunBtn');
const airtestLogsOutput = document.getElementById('airtestLogsOutput');

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

    appendAirtestLog(`\n[System] Starting task ${taskId} with script ${scriptId}...\n`);

    ws.send(JSON.stringify({
      type: 'run_task',
      deviceId: currentDeviceId,
      task_id: taskId,
      script_id: scriptId,
      script_url: `${apiBase}/api/scripts/${scriptId}`,
      vars: vars
    }));
  });
}

function appendAirtestLog(text) {
  if (!airtestLogsOutput) return;
  const chunk = document.createTextNode(text);
  airtestLogsOutput.appendChild(chunk);
  airtestLogsOutput.scrollTop = airtestLogsOutput.scrollHeight;
}

function handleAirtestTaskResult(msg) {
  appendAirtestLog(`\n[System] Task ${msg.task_id} completed with status: ${msg.status}\n`);
  if (msg.message) {
    appendAirtestLog(`[System] Message: ${msg.message}\n`);
  }
  if (msg.files && msg.files.length > 0) {
    appendAirtestLog(`[System] Downloaded artifacts: ${msg.files.join(', ')}\n`);
  }
}

// Fetch scripts initially after login
const origShowApp = window.showApp || (() => { });
function overrideShowApp() {
  origShowApp();
  fetchAirtestScripts();
}
// since showApp is not defined globally, we just hook into restoreSession and login success
// Note: We're calling fetchAirtestScripts right now to ensure it runs
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (authToken) fetchAirtestScripts();
  }, 1000);
});
