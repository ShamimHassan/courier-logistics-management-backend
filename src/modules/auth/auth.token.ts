import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import type { Role } from '../../../prisma/generated/client/enums';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;   // userId
  role: Role;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string; // raw — returned to client, NEVER stored
  expiresIn: number;    // seconds (always 900 for 15m access token)
}

// ─── TTL helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a duration string like "15m", "30d", "1h" into milliseconds.
 * Supported units: s, m, h, d
 */
const parseTtlMs = (ttl: string): number => {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid TTL format: "${ttl}"`);
  const value = parseInt(match[1], 10);
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[match[2]];
};

// ─── JWT ──────────────────────────────────────────────────────────────────────

export const signAccessToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'courierflow',
    audience: 'courierflow-client',
  });
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'courierflow',
    audience: 'courierflow-client',
  }) as JwtPayload;
};

// ─── Refresh token ────────────────────────────────────────────────────────────

const REFRESH_TOKEN_BYTES = 48; // 48 raw bytes → 64 char base64url string
const REFRESH_HASH_ROUNDS = 10; // lighter than password hash — token is already random

/**
 * Generate a cryptographically random raw refresh token.
 * The RAW token is returned to the client; only the HASH is stored in DB.
 */
export const generateRawRefreshToken = (): string => {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
};

export const hashRefreshToken = (raw: string): Promise<string> => {
  return bcrypt.hash(raw, REFRESH_HASH_ROUNDS);
};

export const verifyRefreshTokenHash = (raw: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(raw, hash);
};

/**
 * Calculate the absolute expiry Date from the REFRESH_TOKEN_TTL env value.
 */
export const refreshTokenExpiresAt = (): Date => {
  return new Date(Date.now() + parseTtlMs(env.REFRESH_TOKEN_TTL));
};
