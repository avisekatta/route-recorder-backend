const express = require('express');
const { verifyPassword, createToken, authRequired, hashPassword } = require('../auth');
const store = require('../store');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and PIN are required.' });
  }
  const user = store.findUserByUsername(String(username));
  if (!user || !user.active || !verifyPassword(String(password), user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or PIN.' });
  }
  const token = createToken(user.id, user.role);
  res.json({ token, userId: user.id, displayName: user.displayName, role: user.role });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ userId: req.user.id, displayName: req.user.displayName, role: req.user.role });
});

// Change the signed-in user's own PIN.
router.post('/change-pin', authRequired, (req, res) => {
  const { currentPin, newPin } = req.body || {};
  if (!currentPin || !newPin) {
    return res.status(400).json({ error: 'Current PIN and new PIN are required.' });
  }
  if (!/^\d{4}$/.test(String(newPin))) {
    return res.status(400).json({ error: 'The new PIN must be exactly 4 digits.' });
  }
  if (!verifyPassword(String(currentPin), req.user.passwordHash)) {
    return res.status(401).json({ error: 'The current PIN is not correct.' });
  }
  store.setUserPin(req.user.id, hashPassword(String(newPin)));
  res.json({ ok: true });
});

module.exports = router;
