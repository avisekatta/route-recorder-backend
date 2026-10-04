const fs = require('fs');
const path = require('path');
const express = require('express');
const { authRequired } = require('../auth');
const store = require('../store');
const { uploadWithRetry, downloadKmlFromDrive } = require('../drive');

const KML_DIR = path.join(__dirname, '..', '..', 'data', 'kml');
const router = express.Router();

router.use(authRequired);

// Register trip metadata. Idempotent: an existing trip ID is returned
// unchanged so repeated attempts can never duplicate a trip.
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!body.tripId || typeof body.tripId !== 'string' || !/^[A-Za-z0-9_-]{4,80}$/.test(body.tripId)) {
    return res.status(400).json({ error: 'A valid tripId is required.' });
  }
  const trip = store.upsertTrip({ ...body, userId: req.user.id });
  res.json({
    tripId: trip.tripId,
    status: trip.status,
    driveFileId: trip.driveFileId,
    lastError: trip.lastError,
  });
});

// Receive the KML (raw XML body), store it locally, then upload to Google
// Drive with retries. Responds with the final status.
router.post('/:tripId/kml', async (req, res) => {
  const trip = store.getTrip(req.params.tripId);
  if (!trip || trip.userId !== req.user.id) {
    return res.status(404).json({ error: 'Trip not found.' });
  }
  if (typeof req.body !== 'string' || req.body.length < 50) {
    return res.status(400).json({ error: 'KML content is required.' });
  }
  const trimmed = req.body.trimStart();
  if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<kml')) {
    return res.status(400).json({ error: 'The uploaded file does not look like KML.' });
  }
  fs.mkdirSync(KML_DIR, { recursive: true });
  fs.writeFileSync(path.join(KML_DIR, `${trip.tripId}.kml`), req.body, 'utf8');
  store.setTripStatus(trip.tripId, 'syncing');
  try {
    const result = await uploadWithRetry(trip, req.body);
    store.setTripStatus(trip.tripId, 'synced', null, { driveFileId: result.fileId });
    res.json({ status: 'synced', fileId: result.fileId, alreadyExisted: !!result.alreadyExisted });
  } catch (err) {
    const message = String((err && err.message) || err);
    store.setTripStatus(trip.tripId, 'failed', message);
    res.status(502).json({ status: 'failed', error: message });
  }
});

router.get('/', (req, res) => {
  if (req.user.role === 'admin') {
    // Administrators see every account's routes; each entry carries the
    // owner's username so the app can label foreign routes on the phone.
    const usernames = {};
    for (const u of store.listUsers()) usernames[u.id] = u.username;
    return res.json(
      store.listTrips().map((t) => ({ ...t, ownerUsername: usernames[t.userId] || t.userId }))
    );
  }
  res.json(store.listTrips(req.user.id));
});

// Download the KML for one of the user's own trips (local copy first, then
// the Google Drive copy) — used by the app's "Restore from server" feature.
// Administrators may read any account's KML.
router.get('/:tripId/kml', async (req, res) => {
  const trip = store.getTrip(req.params.tripId);
  const canRead = trip && (trip.userId === req.user.id || req.user.role === 'admin');
  if (canRead) {
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

module.exports = router;
