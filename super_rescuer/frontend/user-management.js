const sessionUser = document.getElementById('sessionUser');
const logoutButton = document.getElementById('logoutButton');

const userManagementHint = document.getElementById('userManagementHint');
const userManagementBody = document.getElementById('userManagementBody');
const newUsernameInput = document.getElementById('newUsername');
const newPasswordInput = document.getElementById('newPassword');
const newRoleSelect = document.getElementById('newRole');
const saveUserButton = document.getElementById('saveUserButton');
const cancelEditUserButton = document.getElementById('cancelEditUserButton');
const saveUserStatus = document.getElementById('saveUserStatus');
const userList = document.getElementById('userList');
const userFormTitle = document.getElementById('userFormTitle');

const STORAGE_TOKEN_KEY = 'riderAuthToken';
const STORAGE_URL_KEY = 'riderServerUrl';

let apiBase = '';
let authToken = '';
let currentUser = null;
let users = [];
let editingUserId = null;

function setHint(message, isError = false) {
  if (!userManagementHint) {
    return;
  }
  userManagementHint.textContent = message || '';
  userManagementHint.classList.toggle('error', isError);
}

function setSaveUserStatus(message, isError = false) {
  if (!saveUserStatus) {
    return;
  }
  saveUserStatus.textContent = message || '';
  saveUserStatus.classList.toggle('error', isError);
}

function setPageEnabled(enabled) {
  if (!userManagementBody) {
    return;
  }
  userManagementBody.classList.toggle('hidden', !enabled);
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }
  return date.toLocaleString();
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

function resetUserForm() {
  editingUserId = null;
  userFormTitle.textContent = 'Create New User';
  newUsernameInput.value = '';
  newUsernameInput.disabled = false;
  newRoleSelect.value = 'operator';
  newPasswordInput.value = '';
  newPasswordInput.placeholder = 'Password (leave empty to keep current)';
  saveUserButton.textContent = 'Create User';
  cancelEditUserButton.classList.add('hidden');
  setSaveUserStatus('');
}

function editUser(user) {
  editingUserId = user.id;
  userFormTitle.textContent = `Edit User: ${user.username}`;
  newUsernameInput.value = user.username;
  newUsernameInput.disabled = true;
  newRoleSelect.value = user.role;
  newPasswordInput.value = '';
  newPasswordInput.placeholder = 'New Password (blank to keep)';
  saveUserButton.textContent = 'Update User';
  cancelEditUserButton.classList.remove('hidden');
  setSaveUserStatus('');
}

function renderUserList() {
  userList.innerHTML = '';
  users.forEach((user) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';

    const info = document.createElement('div');
    const safeUsername = escapeHtml(user.username);
    const safeRole = escapeHtml(user.role);
    const safeUpdatedAt = escapeHtml(formatTimestamp(user.updatedAt));
    info.innerHTML = `
      <strong>${safeUsername}</strong> <span class="muted">(${safeRole})</span>
      <div class="muted" style="font-size: 11px;">Updated: ${safeUpdatedAt}</div>
    `;

    const btnEdit = document.createElement('button');
    btnEdit.textContent = 'Edit';
    btnEdit.className = 'ghost';
    btnEdit.style.marginTop = '0';
    btnEdit.style.padding = '6px 12px';
    btnEdit.style.fontSize = '13px';
    btnEdit.onclick = () => editUser(user);

    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Delete';
    btnDelete.className = 'ghost';
    btnDelete.style.marginTop = '0';
    btnDelete.style.marginLeft = '8px';
    btnDelete.style.padding = '6px 12px';
    btnDelete.style.fontSize = '13px';
    btnDelete.style.color = '#c43a2f';
    btnDelete.style.borderColor = '#c43a2f';
    btnDelete.onclick = () => deleteUser(user);

    if (user.id === currentUser.id) {
      btnDelete.disabled = true;
      btnDelete.style.opacity = '0.5';
      btnDelete.style.cursor = 'not-allowed';
    }

    const actions = document.createElement('div');
    actions.appendChild(btnEdit);
    actions.appendChild(btnDelete);

    item.appendChild(info);
    item.appendChild(actions);
    userList.appendChild(item);
  });
}

async function loadUsers() {
  const res = await apiRequest('/api/users');
  users = res.users || [];
  renderUserList();
}

async function deleteUser(user) {
  if (!confirm(`Are you sure you want to delete user "${user.username}"?`)) {
    return;
  }

  try {
    setSaveUserStatus(`Deleting user ${user.username}...`);
    await apiRequest(`/api/users/${user.id}`, { method: 'DELETE' });
    if (editingUserId === user.id) {
      resetUserForm();
    }
    await loadUsers();
    setSaveUserStatus('User deleted.');
  } catch (err) {
    const message = err?.message || '';
    let note = 'Failed to delete user.';
    if (message.includes('400')) {
      note = 'Cannot delete yourself.';
    } else if (message.includes('403')) {
      note = 'Forbidden: admin only.';
    }
    setSaveUserStatus(note, true);
  }
}

async function saveUser() {
  const username = newUsernameInput.value.trim();
  const password = newPasswordInput.value || '';
  const role = newRoleSelect.value || 'operator';

  if (!username) {
    setSaveUserStatus('Username is required.', true);
    return;
  }

  if (!editingUserId && !password) {
    setSaveUserStatus('Password is required for new users.', true);
    return;
  }

  try {
    if (editingUserId) {
      setSaveUserStatus('Updating user...');
      const payload = { role };
      if (password) {
        payload.password = password;
      }
      await apiRequest(`/api/users/${editingUserId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setSaveUserStatus('User updated.');
    } else {
      setSaveUserStatus('Creating user...');
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, role }),
      });
      setSaveUserStatus('User created.');
    }

    resetUserForm();
    await loadUsers();
  } catch (err) {
    const message = err?.message || '';
    let note = editingUserId ? 'Failed to update user.' : 'Failed to create user.';
    if (message.includes('403')) {
      note = 'Forbidden: admin only.';
    } else if (message.includes('409')) {
      note = 'Username already exists.';
    }
    setSaveUserStatus(note, true);
  }
}

function logout() {
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  window.location.href = 'index.html';
}

async function init() {
  apiBase = localStorage.getItem(STORAGE_URL_KEY) || '';
  authToken = localStorage.getItem(STORAGE_TOKEN_KEY) || '';

  if (!apiBase || !authToken) {
    setPageEnabled(false);
    setHint('Please sign in on the main console first.', true);
    return;
  }

  try {
    const me = await apiRequest('/api/me');
    currentUser = me.user;
    sessionUser.textContent = `${me.user.username} (${me.user.role})`;

    if (me.user.role !== 'admin') {
      setPageEnabled(false);
      setHint('Admin permission required.', true);
      return;
    }

    setPageEnabled(true);
    setHint('');
    resetUserForm();
    await loadUsers();
  } catch (err) {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    setPageEnabled(false);
    setHint('Unable to load user management. Please sign in again.', true);
  }
}

saveUserButton?.addEventListener('click', saveUser);
cancelEditUserButton?.addEventListener('click', resetUserForm);
logoutButton?.addEventListener('click', logout);

init();
