const auditList = document.getElementById('auditList');
const auditHint = document.getElementById('auditHint');
const sessionUser = document.getElementById('sessionUser');

const STORAGE_TOKEN_KEY = 'riderAuthToken';
const STORAGE_URL_KEY = 'riderServerUrl';

let apiBase = '';
let authToken = '';

function setHint(message) {
  auditHint.textContent = message || '';
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

function renderAudits(audits) {
  auditList.innerHTML = '';
  audits.slice().reverse().forEach((audit) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const safeAction = escapeHtml(audit.action);
    const safeActor = escapeHtml(audit.actor || '');
    const safeDeviceId = escapeHtml(audit.deviceId || '');
    const safeTimestamp = escapeHtml(new Date(audit.ts).toLocaleString());
    item.innerHTML = `
      <strong>${safeAction}</strong>
      <div class="muted">${safeActor} -> ${safeDeviceId}</div>
      <div class="muted">${safeTimestamp}</div>
    `;
    auditList.appendChild(item);
  });
}

async function loadAudits() {
  apiBase = localStorage.getItem(STORAGE_URL_KEY) || '';
  authToken = localStorage.getItem(STORAGE_TOKEN_KEY) || '';

  if (!apiBase || !authToken) {
    setHint('Please sign in on the main console first.');
    return;
  }

  try {
    const me = await apiRequest('/api/me');
    sessionUser.textContent = `${me.user.username} (${me.user.role})`;
    const data = await apiRequest('/api/audits');
    renderAudits(data.audits || []);
    setHint('');
  } catch (err) {
    setHint('Unable to load audits. Please sign in again.');
  }
}

loadAudits();
