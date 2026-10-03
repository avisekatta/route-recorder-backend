const fs = require('fs');
const path = require('path');
const express = require('express');
const { authRequired } = require('../auth');
const store = require('../store');
const { uploadWithRetry } = require('../drive');

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
  res.json(store.listTrips(req.user.id));
});

module.exports = router;
