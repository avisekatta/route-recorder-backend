// One-time Google Drive authorisation helper.
//
// Creates an OAuth refresh token for the administrator's own Google account so
// the backend can upload KML files without a service-account key (useful when
// the organisation blocks service-account key creation).
//
// Before running:
//   1. In the Google Cloud console, create an OAuth client ID of type
//      "Desktop app" (APIs and Services -> Credentials -> Create Credentials).
//   2. Put the client ID and secret into backend/.env as
//      GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.
//   3. On the OAuth consent screen, add your own email as a test user.
//
// Then run:  npm run authorize
// Sign in with the account that owns the central Drive folder, and copy the
// printed refresh token into backend/.env as GOOGLE_OAUTH_REFRESH_TOKEN.
require('dotenv').config();
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const PORT = 39001;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in backend/.env first.');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

console.log('Open this address in your browser and sign in with the account');
console.log('that owns the central Drive folder:\n');
console.log(authUrl + '\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Waiting for Google redirect…');
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('No authorisation code received. Close this window and try again.');
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Authorisation complete. You can close this window.');
    console.log('\nAuthorisation complete.\n');
    console.log('Copy this refresh token into backend/.env as GOOGLE_OAUTH_REFRESH_TOKEN:\n');
    console.log(tokens.refresh_token);
    console.log();
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Token exchange failed: ' + String((err && err.message) || err));
    console.error('Token exchange failed:', err.message);
  }
  server.close(() => process.exit(0));
});

server.listen(PORT, () => {
  console.log(`Waiting for the Google redirect on ${REDIRECT} …`);
});
