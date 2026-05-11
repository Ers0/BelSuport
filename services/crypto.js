// services/crypto.js
// AES-256-GCM field-level encryption
// Old plaintext data is detected by absence of "enc:" prefix — no migration needed
// All new writes are encrypted, all reads transparently decrypt

'use strict';

const crypto = require('crypto');

// ── Key setup ─────────────────────────────────────────────────────────────────
// ENCRYPTION_KEY must be 64 hex chars (32 bytes) in .env
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
function getMasterKey() {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) {
    console.warn('[Crypto] ENCRYPTION_KEY not set — encryption disabled');
    return null;
  }
  if (k.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  return Buffer.from(k, 'hex');
}

// Derive a per-user key from master key + userId (HMAC-SHA256)
// Admins/masters always use master key so they can decrypt any record
function deriveKey(userId, role) {
  const master = getMasterKey();
  if (!master) return null;
  if (!userId || ['admin','master'].includes(role)) return master;
  return crypto.createHmac('sha256', master).update(String(userId)).digest();
}

// ── Core encrypt / decrypt ────────────────────────────────────────────────────
const PREFIX = 'enc:';
const IV_LEN = 12;  // 96-bit IV for GCM
const TAG_LEN = 16; // 128-bit auth tag

function _encrypt(plaintext, key) {
  const iv      = crypto.randomBytes(IV_LEN);
  const cipher  = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc     = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function _decrypt(ciphertext, key) {
  const buf = Buffer.from(ciphertext.slice(PREFIX.length), 'base64');
  const iv  = buf.slice(0, IV_LEN);
  const tag = buf.slice(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.slice(IV_LEN + TAG_LEN);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return dec.update(enc) + dec.final('utf8');
}

// ── Public helpers ────────────────────────────────────────────────────────────

// Encrypt a single field value. Returns plaintext if ENCRYPTION_KEY not set.
function encryptField(value, key) {
  if (value === null || value === undefined || value === '') return value;
  if (!key) return value; // encryption disabled
  if (typeof value !== 'string') value = String(value);
  if (value.startsWith(PREFIX)) return value; // already encrypted
  try { return _encrypt(value, key); }
  catch (e) { console.error('[Crypto] encrypt error:', e.message); return value; }
}

// Decrypt a single field value. Returns as-is if not encrypted (old plaintext data).
function decryptField(value, key) {
  if (!value || typeof value !== 'string') return value;
  if (!value.startsWith(PREFIX)) return value; // old plaintext — return as-is
  if (!key) return '[ENCRYPTED]'; // key not available
  try { return _decrypt(value, key); }
  catch (e) { console.error('[Crypto] decrypt error:', e.message); return '[DECRYPT_ERROR]'; }
}

// Encrypt specified fields in an object
function encryptFields(obj, fields, key) {
  if (!obj || !key) return obj;
  const out = { ...obj };
  for (const f of fields) {
    if (out[f] !== undefined && out[f] !== null) {
      out[f] = encryptField(out[f], key);
    }
  }
  return out;
}

// Decrypt specified fields in an object
function decryptFields(obj, fields, key) {
  if (!obj) return obj;
  const out = { ...obj };
  for (const f of fields) {
    if (out[f] !== undefined && out[f] !== null) {
      out[f] = decryptField(out[f], key);
    }
  }
  return out;
}

// Decrypt an array of objects
function decryptRows(rows, fields, key) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(r => decryptFields(r, fields, key));
}

// Get key from request user context
function keyFromReq(req) {
  const master = getMasterKey();
  if (!master) return null;
  const role = req.user?.role || 'technician';
  if (['admin','master'].includes(role)) return master;
  return deriveKey(req.user?.id, role);
}

// ── Field definitions per table ───────────────────────────────────────────────
const ENCRYPTED_FIELDS = {
  chamados: [
    'contato','integrador','cliente_final','tel_integrador','relato','sn','ven',
  ],
  settings_user: [
    'google_token','drive_id','jira_email','jira_token','solutions_drive_id',
  ],
  reminders: [
    'client_name','phone','note',
  ],
  contact_entities: [
    'name','phone','email',
    'fabricante_contact_name','fabricante_contact_role','fabricante_contact_phone','notes',
  ],
  contact_attempts: ['notes'],
  contact_sessions: ['notes'],
  access_requests:  ['email','name'],
  user_approvals:   ['email'],
};

module.exports = {
  getMasterKey, deriveKey, keyFromReq,
  encryptField, decryptField,
  encryptFields, decryptFields, decryptRows,
  ENCRYPTED_FIELDS,
};
