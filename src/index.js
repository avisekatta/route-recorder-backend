require('dotenv').config();
const express = require('express');
const path = require('path');
const store = require('./store');
const auth = require('./auth');

store.init();

const adminCreated = store.ensureDefaultAdmin({
  username: process.env.ADMIN_USERNAME || 'admin',
  passwordHash: auth.hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
});
if (adminCreated) {
  console.log(`Default administrator account created: "${adminCreated.username}". Change ADMIN_PASSWORD and restart, or add users and deactivate it.`);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(
  express.text({
    type: ['application/vnd.google-earth.kml+xml', 'text/xml', 'application/xml'],
    limit: '10mb',
  })
);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/trips', require('./routes/trips'));
app.use('/api/admin', require('./routes/admin'));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// Express error handler (also catches JSON parse errors)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return;
  const status = err && err.status ? err.status : 400;
  res.status(status).json({ error: status === 400 ? 'Invalid request body.' : 'Internal server error.' });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`Route Recorder backend listening on port ${port}`);
  console.log(`Administrator interface: http://localhost:${port}/admin`);
  if (!process.env.DRIVE_FOLDER_ID) {
    console.log('WARNING: DRIVE_FOLDER_ID is not set - Drive uploads will fail until it is configured in backend/.env.');
  }
  const hasOAuth =
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (hasOAuth) {
    console.log('Google Drive connection: OAuth refresh token');
  } else if (fsExists(serviceAccountPath())) {
    console.log('Google Drive connection: service account key');
  } else {
    console.log('WARNING: no Google credential configured - set GOOGLE_OAUTH_* in backend/.env or add config/service-account.json (see backend/config/README.md).');
  }
});

function fsExists(p) {
  try {
    require('fs').statSync(p);
    return true;
  } catch {
    return false;
  }
}

function serviceAccountPath() {
  return path.join(__dirname, '..', 'config', 'service-account.json');
}
