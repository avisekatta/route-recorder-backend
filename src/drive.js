// Google Drive integration for the backend only. The service-account key never
// leaves the server. The central folder must be shared with the service-account
// email (see backend/config/README.md).
//
// Uploads follow the folder layout:
//   <central folder>/<user-id>/<YYYY-MM>/<YYYY-MM-DD>_<HHMM>_<Route-Name>_<Trip-ID>.kml
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const KEY_FILE = path.join(__dirname, '..', 'config', 'service-account.json');
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const KML_MIME = 'application/vnd.google-earth.kml+xml';

let driveClient = null;

function buildAuth() {
  // Preferred: OAuth refresh token. Works even when the organisation blocks
  // service-account key creation (Google's Secure by Default policy).
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    const auth = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'http://localhost:39001/oauth2callback'
    );
    auth.setCredentials({ refresh_token: refreshToken });
    return auth;
  }
  // Fallback: a service-account key file, when the organisation allows keys.
  if (fs.existsSync(KEY_FILE)) {
    return new google.auth.GoogleAuth({
      keyFile: KEY_FILE,
      // Broad scope because the central folder is owned by the administrator's
      // account and merely shared with this dedicated service account.
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  }
  throw new Error(
    'No Google credential configured. Set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / ' +
      'GOOGLE_OAUTH_REFRESH_TOKEN in backend/.env (run "npm run authorize" once), or provide ' +
      'backend/config/service-account.json — see backend/config/README.md.'
  );
}

function getDrive() {
  if (!driveClient) {
    driveClient = google.drive({ version: 'v3', auth: buildAuth() });
  }
  return driveClient;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableError(err) {
  const code = Number(err && (err.code || (err.response && err.response.status)));
  if (code) return [403, 408, 409, 429, 500, 502, 503, 504].includes(code);
  return true; // network-level failures without an HTTP status
}

async function ensureFolder(parentId, name) {
  const escaped = String(name).replace(/'/g, "\\'");
  const q = `name = '${escaped}' and mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed = false`;
  const list = await getDrive().files.list({ q, fields: 'files(id, name)', pageSize: 5 });
  if (list.data.files && list.data.files.length) return list.data.files[0].id;
  const created = await getDrive().files.create({
    requestBody: { name: String(name), mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id',
  });
  return created.data.id;
}

function buildFilename(trip) {
  const day = trip.startedLocal || new Date(trip.startedAtMs).toISOString().slice(0, 10);
  const time = (trip.startedTime || '0000').replace(/[^\d]/g, '').slice(0, 4);
  const safeName =
    String(trip.routeName || 'Route')
      .replace(/[^\p{L}\p{N} _-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'Route';
  return `${day}_${time}_${safeName}_${trip.tripId}.kml`;
}

async function findExistingKml(parentId, tripId) {
  const q = `name contains '${tripId}' and '${parentId}' in parents and trashed = false`;
  const list = await getDrive().files.list({ q, fields: 'files(id, name)', pageSize: 10 });
  return (list.data.files || []).map((f) => ({ id: f.id, name: f.name }));
}

async function uploadOnce(trip, kml) {
  const rootId = process.env.DRIVE_FOLDER_ID;
  if (!rootId) throw new Error('DRIVE_FOLDER_ID is not configured in backend/.env');

  // Verify the central folder is visible to the service account. If not, the
  // share with the service-account email is missing.
  const root = await getDrive().files.get({ fileId: rootId, fields: 'id, name' });
  if (!root.data || !root.data.id) {
    throw new Error('Central Drive folder is not visible to the service account — share it with the service-account email.');
  }

  const userFolder = await ensureFolder(rootId, trip.userId);
  const month = trip.startedLocal
    ? String(trip.startedLocal).slice(0, 7)
    : new Date(trip.startedAtMs).toISOString().slice(0, 7);
  const monthFolder = await ensureFolder(userFolder, month);

  // Duplicate prevention: if a file containing this trip ID already exists,
  // reuse it instead of uploading again.
  const existing = await findExistingKml(monthFolder, trip.tripId);
  if (existing.length) {
    return { status: 'synced', fileId: existing[0].id, alreadyExisted: true };
  }

  const filename = buildFilename(trip);
  const created = await getDrive().files.create({
    requestBody: { name: filename, parents: [monthFolder], mimeType: KML_MIME },
    media: { mimeType: KML_MIME, body: kml },
    fields: 'id, name',
  });
  return { status: 'synced', fileId: created.data.id, alreadyExisted: false };
}

async function uploadWithRetry(trip, kml, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await uploadOnce(trip, kml);
    } catch (err) {
      lastError = err;
      if (attempt < attempts && isRetryableError(err)) {
        await sleep(2000 * 2 ** (attempt - 1)); // 2s, 4s
        continue;
      }
      break;
    }
  }
  throw lastError;
}

module.exports = { uploadWithRetry };
