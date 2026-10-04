const fs = require('fs');
const path = require('path');
const express = require('express');
const { adminRequired, hashPassword } = require('../auth');
const store = require('../store');
const { uploadWithRetry, downloadKmlFromDrive } = require('../drive');

const KML_DIR = path.join(__dirname, '..', '..', 'data', 'kml');
const router = express.Router();

router.use(adminRequired);

router.get('/users', (req, res) => {
  res.json(store.listUsers());
});

router.post('/users', (req, res) => {
  const { username, displayName } = req.body || {};
  if (!username) {
    return res.status(400).json({ error: 'Username is required.' });
  }
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(String(username))) {
    return res.status(400).json({ error: 'Username may contain only letters, numbers, dot, dash or underscore (3–40 characters).' });
  }
  const user = store.createUser({
    username: String(username),
    // Every account starts with the default PIN 1234; users change it in the app.
    passwordHash: hashPassword('1234'),
    displayName: String(displayName || username),
  });
  if (!user) return res.status(409).json({ error: 'That username is already in use.' });
  res.status(201).json({ ...user, defaultPin: '1234' });
});

router.post('/users/:id/toggle', (req, res) => {
  const user = store.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const updated = store.setUserActive(user.id, !user.active);
  res.json(updated);
});

// Reset a user's PIN back to the default 1234.
router.post('/users/:id/reset-pin', (req, res) => {
  const user = store.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  store.setUserPin(user.id, hashPassword('1234'));
  res.json({ ok: true, message: 'PIN reset to 1234.' });
});

router.get('/trips', (req, res) => {
  res.json(store.listTrips());
});

// Download the KML for one trip: local copy first, then Google Drive fallback
// (the local disk is reset on redeploys; Drive keeps the files).
router.get('/trips/:tripId/kml', async (req, res) => {
  const trip = store.getTrip(req.params.tripId);
  if (trip) {
    const file = path.join(KML_DIR, `${trip.tripId}.kml`);
    if (fs.existsSync(file)) {
      res.type('application/vnd.google-earth.kml+xml');
      return res.send(fs.readFileSync(file, 'utf8'));
    }
  }
  try {
    const kml = await downloadKmlFromDrive(req.params.tripId);
    if (kml) {
      res.type('application/vnd.google-earth.kml+xml');
      return res.send(kml);
    }
  } catch (err) {
    return res.status(502).json({ error: 'Could not read the KML from Google Drive: ' + String((err && err.message) || err) });
  }
  res.status(404).json({ error: 'No KML found for this trip.' });
});

// Retry a failed upload using the KML stored on the server.
router.post('/trips/:tripId/retry', async (req, res) => {
  const trip = store.getTrip(req.params.tripId);
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });
  const file = path.join(KML_DIR, `${trip.tripId}.kml`);
  if (!fs.existsSync(file)) {
    return res.status(400).json({ error: 'No KML file stored for this trip.' });
  }
  const kml = fs.readFileSync(file, 'utf8');
  store.setTripStatus(trip.tripId, 'syncing');
  try {
    const result = await uploadWithRetry(trip, kml);
    store.setTripStatus(trip.tripId, 'synced', null, { driveFileId: result.fileId });
    res.json({ status: 'synced', fileId: result.fileId, alreadyExisted: !!result.alreadyExisted });
  } catch (err) {
    const message = String((err && err.message) || err);
    store.setTripStatus(trip.tripId, 'failed', message);
    res.status(502).json({ status: 'failed', error: message });
  }
});

module.exports = router;
