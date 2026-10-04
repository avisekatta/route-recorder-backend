// Tiny JSON-file data store. Enough for a small closed group of approved users
// and avoids a database dependency. Files live in backend/data and are written
// atomically (write to a temp file, then rename).
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TRIPS_FILE = path.join(DATA_DIR, 'trips.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

// users: [{ id, username, passwordHash, displayName, role: 'user'|'admin', active, createdAt }]
let users = [];
// trips: tripId -> { tripId, userId, routeName, startedAtMs, startedLocal, startedTime,
//   endedAtMs, distanceM, durationMs, pointCount, segmentCount, status, lastError, driveFileId, updatedAt }
// status: 'awaiting_kml' | 'syncing' | 'synced' | 'failed'
let trips = {};
// tokens: token -> { userId, role, expiresAt }
let tokens = {};

// Optional handler that receives a full backup payload after each save
// (debounced). Used to persist data to Google Drive across redeploys.
let backupHandler = null;
let backupTimer = null;

function scheduleBackup() {
  if (!backupHandler) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupTimer = null;
    try {
      backupHandler(JSON.stringify({ users, trips, tokens, updatedAt: Date.now() }));
    } catch (err) {
      /* backup is best-effort */
    }
  }, 3000);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeAtomic(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function saveAll() {
  writeAtomic(USERS_FILE, users);
  writeAtomic(TRIPS_FILE, trips);
  writeAtomic(TOKENS_FILE, tokens);
  scheduleBackup();
}

module.exports = {
  init() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    users = readJson(USERS_FILE, []);
    trips = readJson(TRIPS_FILE, {});
    tokens = readJson(TOKENS_FILE, {});
  },

  // ---- users ----
  findUserByUsername(username) {
    return users.find((u) => u.username === username) || null;
  },
  findUserById(id) {
    return users.find((u) => u.id === id) || null;
  },
  listUsers() {
    return users.map(({ passwordHash, ...rest }) => rest);
  },
  createUser({ username, passwordHash, displayName, role = 'user' }) {
    if (users.some((u) => u.username === username)) return null;
    const user = {
      id: 'U' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username,
      passwordHash,
      displayName: displayName || username,
      role,
      active: true,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveAll();
    const { passwordHash: _hash, ...pub } = user;
    return pub;
  },
  setUserActive(id, active) {
    const user = this.findUserById(id);
    if (!user) return null;
    user.active = !!active;
    saveAll();
    const { passwordHash, ...pub } = user;
    return pub;
  },
  setUserPin(id, pinHash) {
    const user = this.findUserById(id);
    if (!user) return null;
    user.passwordHash = pinHash;
    saveAll();
    return true;
  },
  ensureDefaultAdmin({ username, passwordHash }) {
    if (!username || !passwordHash) return null;
    if (users.some((u) => u.role === 'admin')) return null;
    const user = {
      id: 'Uadmin1',
      username,
      passwordHash,
      displayName: 'Administrator',
      role: 'admin',
      active: true,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveAll();
    return { username };
  },

  // ---- backup hooks ----
  setBackupHandler(fn) {
    backupHandler = fn;
  },
  isEmpty() {
    return users.length === 0 && Object.keys(trips).length === 0;
  },
  restoreFromBackup(json) {
    const data = JSON.parse(json);
    if (Array.isArray(data.users) && data.users.length) users = data.users;
    if (data.trips && typeof data.trips === 'object') trips = { ...trips, ...data.trips };
    if (data.tokens && typeof data.tokens === 'object') tokens = data.tokens;
    saveAll();
  },

  // ---- backup hooks ----
  setBackupHandler(fn) {
    backupHandler = fn;
  },
  isEmpty() {
    return users.length === 0 && Object.keys(trips).length === 0;
  },
  restoreFromBackup(json) {
    const data = JSON.parse(json);
    if (Array.isArray(data.users) && data.users.length) users = data.users;
    if (data.trips && typeof data.trips === 'object') trips = { ...trips, ...data.trips };
    if (data.tokens && typeof data.tokens === 'object') tokens = data.tokens;
    saveAll();
  },

  // ---- tokens ----
  addToken(record) {
    tokens[record.token] = record;
    saveAll();
  },
  findToken(token) {
    return tokens[token] || null;
  },
  purgeExpiredTokens() {
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(tokens)) {
      if (tokens[key].expiresAt < now) {
        delete tokens[key];
        changed = true;
      }
    }
    if (changed) saveAll();
  },

  // ---- trips ----
  getTrip(tripId) {
    return trips[tripId] || null;
  },
  // Duplicate prevention: if the trip ID already exists it is returned
  // unchanged and is never overwritten.
  upsertTrip(payload) {
    if (trips[payload.tripId]) return trips[payload.tripId];
    const trip = {
      tripId: payload.tripId,
      userId: payload.userId,
      routeName: payload.routeName || '',
      startedAtMs: Number(payload.startedAtMs) || Date.now(),
      startedLocal: payload.startedLocal || '',
      startedTime: payload.startedTime || '',
      endedAtMs: Number(payload.endedAtMs) || null,
      distanceM: Number(payload.distanceM) || 0,
      durationMs: Number(payload.durationMs) || 0,
      pointCount: Number(payload.pointCount) || 0,
      segmentCount: Number(payload.segmentCount) || 0,
      status: 'awaiting_kml',
      lastError: null,
      driveFileId: null,
      updatedAt: new Date().toISOString(),
    };
    trips[trip.tripId] = trip;
    saveAll();
    return trip;
  },
  setTripStatus(tripId, status, lastError = null, extra = {}) {
    const trip = trips[tripId];
    if (!trip) return null;
    trip.status = status;
    trip.lastError = lastError;
    Object.assign(trip, extra);
    trip.updatedAt = new Date().toISOString();
    saveAll();
    return trip;
  },
  listTrips(userId) {
    return Object.values(trips)
      .filter((t) => !userId || t.userId === userId)
      .sort((a, b) => b.startedAtMs - a.startedAtMs);
  },
};
