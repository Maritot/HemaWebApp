/**
 * Client-Side Cryptographic Engine
 * Uses W3C Web Cryptography API (`window.crypto.subtle`) for:
 * 1. PBKDF2-SHA256 password hashing with 100,000 iterations and 128-bit random salt.
 * 2. Timing-safe constant-time hash comparison.
 * 3. Secure session token generation.
 * 4. Security answer normalization and hashing for account recovery.
 */

// Helper to convert Uint8Array to hex string
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to convert hex string to Uint8Array
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Generate 16-byte cryptographically secure random salt
export function generateSalt(): string {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  return bytesToHex(salt);
}

// Generate cryptographically secure random token
export function generateSecureToken(): string {
  const randomBytes = window.crypto.getRandomValues(new Uint8Array(24));
  const hex = bytesToHex(randomBytes);
  const uuid = window.crypto.randomUUID ? window.crypto.randomUUID() : `tok_${Date.now()}`;
  return `${uuid}_${hex}`;
}

// Derive PBKDF2-SHA256 hash
export async function hashPassword(
  password: string, 
  saltHex?: string
): Promise<{ hash: string; salt: string }> {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : window.crypto.getRandomValues(new Uint8Array(16));
  const computedSaltHex = saltHex || bytesToHex(salt);

  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256 // 32 bytes (256 bits)
  );

  const hash = bytesToHex(new Uint8Array(derivedBits));
  return { hash, salt: computedSaltHex };
}

// Verify password with timing-safe comparison
export async function verifyPassword(
  password: string,
  saltHex: string,
  storedHash: string
): Promise<boolean> {
  try {
    const { hash } = await hashPassword(password, saltHex);
    // Constant-time comparison
    if (hash.length !== storedHash.length) return false;
    let result = 0;
    for (let i = 0; i < hash.length; i++) {
      result |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
    }
    return result === 0;
  } catch (err) {
    console.error('[CryptoAuth] Verification error:', err);
    return false;
  }
}

// Hash security answer (normalized to lowercase and trimmed)
export async function hashSecurityAnswer(answer: string, saltHex: string): Promise<string> {
  const normalized = answer.trim().toLowerCase();
  const { hash } = await hashPassword(normalized, saltHex);
  return hash;
}
