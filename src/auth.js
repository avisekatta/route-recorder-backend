// Password hashing and opaque bearer tokens. Tokens are stored server-side so
// they can be invalidated and expired centrally.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const store = require('./store');

function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), 10);
}

function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compareSync(String(plain), hash);
}

function tokenTtlDays() {
  const days = Number(process.env.TOKEN_TTL_DAYS);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

function createToken(userId, role) {
  const token = crypto.randomBytes(32).toString('hex');
  store.addToken({
    token,
    userId,
    role,
    expiresAt: Date.now() + tokenTtlDays() * 24 * 60 * 60 * 1000,
  });
  return token;
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const record = token ? store.findToken(token) : null;
  if (!record || record.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Login required.' });
  }
  const user = store.findUserById(record.userId);
  if (!user || !user.active) {
    return res.status(401).json({ error: 'This account is not active.' });
  }
  req.user = user;
  req.token = token;
  next();
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access required.' });
    }
    next();
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  createToken,
  authRequired,
  adminRequired,
};
