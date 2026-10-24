const crypto = require('node:crypto');
const { getDb } = require('./db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedBuffer = crypto.scryptSync(password, salt, 64);
  if (keyBuffer.length !== derivedBuffer.length) return false;
  return crypto.timingSafeEqual(keyBuffer, derivedBuffer);
}

function createSession(userId) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  // 30 days expiry
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt
  );
  // Cleanup expired sessions occasionally
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return { token, expiresAt };
}

function deleteSession(token) {
  if (!token) return;
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      cookies[k] = decodeURIComponent(v);
    }
  });
  return cookies;
}

function getAuthenticatedUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies.kc_session;

  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }

  if (!token) return null;

  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.disabled, u.showcase_enabled, u.showcase_token, u.created_at, s.token
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token);

  if (!row || row.disabled) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    showcaseEnabled: Boolean(row.showcase_enabled),
    showcaseToken: row.showcase_token || '',
    createdAt: row.created_at,
    token: row.token
  };
}

function getUserCount() {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  return row ? Number(row.cnt) : 0;
}

function isRegistrationAllowed() {
  if (getUserCount() === 0) return true; // First user can always register to become admin
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'allow_registration'").get();
  return row ? row.value === 'true' : true;
}

function setRegistrationAllowed(allowed) {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_registration', ?)").run(
    allowed ? 'true' : 'false'
  );
}

function getAppTagline() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app_tagline'").get();
  return row && row.value ? row.value : 'Model Hangar';
}

function setAppTagline(tagline) {
  const db = getDb();
  const clean = String(tagline || '').trim() || 'Model Hangar';
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app_tagline', ?)").run(clean);
  return clean;
}

function getLegalSettings() {
  const db = getDb();
  const impRow = db.prepare("SELECT value FROM settings WHERE key = 'impressum_text'").get();
  const privRow = db.prepare("SELECT value FROM settings WHERE key = 'privacy_text'").get();
  return {
    impressumText: impRow && impRow.value ? impRow.value : '',
    privacyText: privRow && privRow.value ? privRow.value : ''
  };
}

function setLegalSettings({ impressumText, privacyText }) {
  const db = getDb();
  if (impressumText !== undefined) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('impressum_text', ?)").run(
      String(impressumText).trim()
    );
  }
  if (privacyText !== undefined) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('privacy_text', ?)").run(
      String(privacyText).trim()
    );
  }
  return getLegalSettings();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  getAuthenticatedUser,
  getUserCount,
  isRegistrationAllowed,
  setRegistrationAllowed,
  getAppTagline,
  setAppTagline,
  getLegalSettings,
  setLegalSettings
};
