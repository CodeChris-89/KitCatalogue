const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, ensureDirs } = require('./db');

let cachedMasterKey = null;

/**
 * Loads or generates a 32-byte master key for AES-256-GCM encryption at rest.
 * Priority:
 *   1. process.env.SECRET_KEY / process.env.ENCRYPTION_KEY (derived via SHA-256)
 *   2. Persistent key file in DATA_DIR/.master_key (0600 permissions)
 */
function getMasterKey() {
  if (cachedMasterKey) return cachedMasterKey;

  const envSecret = process.env.SECRET_KEY || process.env.ENCRYPTION_KEY;
  if (envSecret && String(envSecret).trim().length >= 8) {
    cachedMasterKey = crypto.createHash('sha256').update(String(envSecret).trim()).digest();
    return cachedMasterKey;
  }

  ensureDirs();
  const keyFilePath = path.join(DATA_DIR, '.master_key');
  try {
    if (fs.existsSync(keyFilePath)) {
      const hex = fs.readFileSync(keyFilePath, 'utf8').trim();
      if (/^[0-9a-fA-F]{64}$/.test(hex)) {
        cachedMasterKey = Buffer.from(hex, 'hex');
        return cachedMasterKey;
      }
    }
  } catch (_) {
    // Fallback to generating a new key below
  }

  const newKey = crypto.randomBytes(32);
  try {
    fs.writeFileSync(keyFilePath, newKey.toString('hex'), { mode: 0o600 });
  } catch (_) {
    // In read-only environments, keep key in memory for process lifetime
  }
  cachedMasterKey = newKey;
  return cachedMasterKey;
}

/**
 * Encrypts a sensitive string using AES-256-GCM with a random 96-bit IV.
 * Output format: v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */
function encryptSecret(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return '';
  const clean = plaintext.trim();
  if (!clean) return '';

  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a string encrypted by encryptSecret().
 * Returns '' if empty, tampered, or invalid.
 */
function decryptSecret(encryptedPayload) {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') return '';
  const parts = encryptedPayload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';

  try {
    const key = getMasterKey();
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const ciphertext = Buffer.from(parts[3], 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (_) {
    return '';
  }
}

/**
 * Masks an API key so only the last 4 characters are visible in UI responses.
 */
function maskApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return '';
  const clean = rawKey.trim();
  if (!clean) return '';
  if (clean.length <= 6) return '••••••••';
  return `••••••••${clean.slice(-4)}`;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  maskApiKey
};
