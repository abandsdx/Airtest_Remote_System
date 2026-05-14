const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'store.json');

const defaultData = {
  users: [],
  devices: [],
  missions: [],
  audits: [],
  scripts: [],
};

let data = { ...defaultData };
let pendingSaveTimer = null;

function ensureDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(dataFile)) {
    data = { ...defaultData };
    save();
    return;
  }

  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    data = JSON.parse(raw);
  } catch (err) {
    data = { ...defaultData };
    save();
  }
}

function save() {
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  ensureDir();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

function saveSoon(delayMs = 1000) {
  if (pendingSaveTimer) {
    return;
  }
  pendingSaveTimer = setTimeout(() => {
    pendingSaveTimer = null;
    save();
  }, delayMs);
}

function hashPassword(password) {
  // 使用 PBKDF2 (Password-Based Key Derivation Function 2)
  // 這是比 SHA256 更安全的密碼哈希方法
  const salt = 'rider-salt-v1'; // 在生產環境中應該為每個用戶生成唯一的 salt
  const iterations = 100000; // 迭代次數,增加破解難度
  const keylen = 64; // 輸出長度
  const digest = 'sha512'; // 使用 SHA512

  return crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
}

function ensureDefaultAdmin() {
  const adminUser = data.users.find(u => u.username === 'admin');

  if (adminUser) {
    if (adminUser.role !== 'admin') {
      console.log('[Store] Restoring admin role for default admin user...');
      adminUser.role = 'admin';
      adminUser.updatedAt = Date.now();
      save();
    }
    return;
  }

  // 如果不存在則創建
  console.log('[Store] Creating default admin user...');
  data.users.push({
    id: crypto.randomUUID(),
    username: 'admin',
    passwordHash: hashPassword('admin123'),
    role: 'admin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  save();
}

function findUser(username) {
  return data.users.find((user) => user.username === username) || null;
}

function deleteUser(id) {
  const index = data.users.findIndex((u) => u.id === id);
  if (index === -1) {
    return false;
  }
  data.users.splice(index, 1);
  save();
  return true;
}

function upsertDevice(device) {
  const existing = data.devices.find((item) => item.deviceId === device.deviceId);
  if (existing) {
    Object.assign(existing, device, { updatedAt: Date.now() });
  } else {
    data.devices.push({
      ...device,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  save();
  return device;
}

function updateDeviceStatus(deviceId, patch) {
  const device = data.devices.find((item) => item.deviceId === deviceId);
  if (!device) {
    return;
  }
  Object.assign(device, patch, {
    lastSeen: Date.now(),
    updatedAt: Date.now(),
  });
  saveSoon();
}

function addMission(mission) {
  data.missions.push(mission);
  save();
}

function updateMission(missionId, patch) {
  const mission = data.missions.find((item) => item.id === missionId);
  if (!mission) {
    return null;
  }
  Object.assign(mission, patch, { updatedAt: Date.now() });
  save();
  return mission;
}

function addAudit(entry) {
  data.audits.push(entry);
  save();
}





function addScript(script) {
  data.scripts.push(script);
  save();
}

load();
ensureDefaultAdmin();
process.on('exit', () => {
  if (pendingSaveTimer) {
    save();
  }
});

module.exports = {
  data,
  load,
  save,
  saveSoon,
  hashPassword,
  findUser,
  upsertDevice,
  updateDeviceStatus,
  addMission,
  updateMission,
  addAudit,
  deleteUser,
  addScript,
};
