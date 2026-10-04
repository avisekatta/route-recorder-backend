const fs = require('fs');
const path = require('path');
const express = require('express');

const CRASH_DIR = path.join(__dirname, '..', '..', 'data', 'crash-reports');
const MAX_LOG_LENGTH = 200000;
const MAX_FILES = 20;

const router = express.Router();

// Upload a phone crash log (no authentication needed; size is capped).
router.post('/', (req, res) => {
  try {
    const log = req.body && req.body.log ? String(req.body.log).slice(0, MAX_LOG_LENGTH) : '';
    if (!log.trim()) {
      return res.status(400).json({ error: 'Empty crash log.' });
    }
    fs.mkdirSync(CRASH_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(CRASH_DIR, `crash-${stamp}.txt`), log);
    trimOldFiles();
    res.json({ ok: true });
  } catch (err) {
    console.error('Crash log store failed:', err);
    res.status(500).json({ error: 'Could not store the crash log.' });
  }
});

function trimOldFiles() {
  try {
    const files = fs.readdirSync(CRASH_DIR).filter((f) => f.endsWith('.txt')).sort();
    while (files.length > MAX_FILES) {
      fs.unlinkSync(path.join(CRASH_DIR, files.shift()));
    }
  } catch (err) {
    // Non-fatal: the newest report is already saved.
  }
}

module.exports = router;
