import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface JwtClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  jti: string;
}

const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) {
    return false;
  }
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) {
      return false;
    }
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function createJwtToken(
  payload: { sub: string; email: string },
  secret: string,
  ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = {
    sub: payload.sub,
    email: payload.email,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  };

  const headerEncoded = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadEncoded = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

export function verifyJwtToken(token: string, secret: string): JwtClaims | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
  if (!headerEncoded || !payloadEncoded || !signatureEncoded) return null;

  try {
    const signingInput = `${headerEncoded}.${payloadEncoded}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(signingInput)
      .digest('base64url');

    const sigBuf = Buffer.from(signatureEncoded, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const header = JSON.parse(base64UrlDecode(headerEncoded)) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256') {
      return null;
    }

    const claims = JSON.parse(base64UrlDecode(payloadEncoded)) as Partial<JwtClaims>;
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      typeof claims.email !== 'string' ||
      typeof claims.exp !== 'number' ||
      claims.exp <= now
    ) {
      return null;
    }

    return claims as JwtClaims;
  } catch {
    return null;
  }
}

export function getOrInitJwtSecret(dataDir: string): string {
  const envSecret = process.env.JWT_SECRET_KEY?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const secretPath = path.join(dataDir, '.jwt_secret');
  if (fs.existsSync(secretPath)) {
    const stored = fs.readFileSync(secretPath, 'utf8').trim();
    if (stored.length >= 32) {
      return stored;
    }
  }

  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

export function deriveChatTitle(firstQuestion: string): string {
  const compact = firstQuestion.replace(/\s+/g, ' ').trim();
  if (!compact) return 'New Chat';
  if (compact.length <= 54) return compact;
  const sliced = compact.slice(0, 51);
  const lastSpace = sliced.lastIndexOf(' ');
  const cutoff = lastSpace >= 28 ? lastSpace : 51;
  return `${sliced.slice(0, cutoff).trim()}...`;
}

export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
