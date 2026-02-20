// src/services/encryptionService.js - AES-256-GCM encryption for PII fields
const crypto = require('crypto');

const ALGORITHM  = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH  = 16; // 128 bits

// Configurable salt — override via ENCRYPTION_SALT env var per tenant
const SALT = process.env.ENCRYPTION_SALT || 'homecare-crm-encryption-salt-v1';

let _cachedKey = null;
const getKey = () => {
  if (_cachedKey) return _cachedKey;

  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  if (envKey.length === 64 && /^[0-9a-f]+$/i.test(envKey)) {
    _cachedKey = Buffer.from(envKey, 'hex');
  } else {
    _cachedKey = crypto.scryptSync(envKey, SALT, KEY_LENGTH);
  }
  return _cachedKey;
};

const encrypt = (plaintext) => {
  if (plaintext === null || plaintext === undefined) return null;
  try {
    const key    = getKey();
    const iv     = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
  } catch (error) {
    console.error('[ENCRYPTION] Encrypt error:', error.message);
    throw new Error('Encryption failed');
  }
};

const decrypt = (encryptedValue) => {
  if (!encryptedValue) return null;
  try {
    const key    = getKey();
    const parts  = encryptedValue.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    const iv         = Buffer.from(parts[0], 'base64');
    const authTag    = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    console.error('[ENCRYPTION] Decrypt error:', error.message);
    return null;
  }
};

const maskSSN     = (ssn) => { if (!ssn) return null; const c = ssn.replace(/\D/g,''); return `***-**-${c.slice(-4)}`; };
const validateSSN = (ssn) => ssn.replace(/\D/g,'').length === 9;
const normalizeSSN = (ssn) => ssn.replace(/\D/g,'');

module.exports = { encrypt, decrypt, maskSSN, validateSSN, normalizeSSN };
