// src/services/encryptionService.js - AES-256-GCM encryption for PII fields
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const TAG_LENGTH = 16;

// Derive a 32-byte key from the env variable
const getKey = () => {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    // Development fallback — NEVER use in production
    console.warn('[ENCRYPTION] No ENCRYPTION_KEY set — using insecure dev key. Set ENCRYPTION_KEY in production!');
    return crypto.scryptSync('dev-fallback-key-change-in-prod', 'cvhc-salt', KEY_LENGTH);
  }
  // If it's a hex string, use it directly; otherwise derive
  if (envKey.length === 64 && /^[0-9a-f]+$/i.test(envKey)) {
    return Buffer.from(envKey, 'hex');
  }
  return crypto.scryptSync(envKey, 'cvhc-crm-salt', KEY_LENGTH);
};

/**
 * Encrypt a string value for storage
 * Returns a base64-encoded string: iv:authTag:ciphertext
 */
const encrypt = (plaintext) => {
  if (!plaintext) return null;
  try {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(String(plaintext), 'utf8'),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    // Store as: base64(iv):base64(authTag):base64(ciphertext)
    return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
  } catch (error) {
    console.error('[ENCRYPTION] Encrypt error:', error.message);
    throw new Error('Encryption failed');
  }
};

/**
 * Decrypt an encrypted string value
 */
const decrypt = (encryptedValue) => {
  if (!encryptedValue) return null;
  try {
    const key = getKey();
    const parts = encryptedValue.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('[ENCRYPTION] Decrypt error:', error.message);
    return null; // Don't throw — return null on failure
  }
};

/**
 * Mask a SSN for display — show only last 4 digits
 */
const maskSSN = (ssn) => {
  if (!ssn) return null;
  const clean = ssn.replace(/\D/g, '');
  if (clean.length < 4) return '***-**-' + clean;
  return `***-**-${clean.slice(-4)}`;
};

/**
 * Validate SSN format (XXX-XX-XXXX or XXXXXXXXX)
 */
const validateSSN = (ssn) => {
  const clean = ssn.replace(/\D/g, '');
  return clean.length === 9;
};

/**
 * Format SSN for storage (remove dashes)
 */
const normalizeSSN = (ssn) => ssn.replace(/\D/g, '');

module.exports = { encrypt, decrypt, maskSSN, validateSSN, normalizeSSN };
