const fs = require('fs');
const path = require('path');
const express = require('express');
const { adminRequired, hashPassword } = require('../auth');
const store = require('../store');
const { uploadWithRetry } = require('../drive');

const KML_DIR = path.join(__dirname, '..', '..', 'data', 'kml');
const router = express.Router();

router.use(adminRequired);

router.get('/users', (req, res) => {
  res.json(store.listUsers());
});

router.post('/users', (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(String(username))) {
    return res.status(400).json({ error: 'Username may contain only letters, numbers, dot, dash or underscore (3–40 characters).' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const user = store.createUser({
    username: String(username),
    passwordHash: hashPassword(String(password)),
    displayName: String(displayName || username),
  });
  if (!user) return res.status(409).json({ error: 'That username is already in use.' });
  res.status(201).json(user);
});

router.post('/users/:id/toggle', (req, res) => {
  const user = store.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const updated = store.setUserActive(user.id, !user.active);
  res.json(updated);
});

router.get('/trips', (req, res) => {
  res.json(store.listTrips());
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
