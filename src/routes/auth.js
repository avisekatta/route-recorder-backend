const express = require('express');
const { verifyPassword, createToken, authRequired } = require('../auth');
const store = require('../store');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const user = store.findUserByUsername(String(username));
  if (!user || !user.active || !verifyPassword(String(password), user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  const token = createToken(user.id, user.role);
  res.json({ token, userId: user.id, displayName: user.displayName, role: user.role });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ userId: req.user.id, displayName: req.user.displayName, role: req.user.role });
});

module.exports = router;
