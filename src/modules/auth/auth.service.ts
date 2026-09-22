import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Role, UserStatus } from '../../../prisma/generated/client/enums';
import { prisma } from '../../config/database';
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from '../../common/errors/AppError';
import type { LoginInput, RegisterInput } from './auth.validation';
import {
  generateRawRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
  signAccessToken,
  verifyRefreshTokenHash,
} from './auth.token';
import type { GoogleProfile } from './auth.google';

const PASSWORD_HASH_ROUNDS = 12;

// ─── Prisma select — no passwordHash ever returned ────────────────────────────

const authUserSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  status: true,
  profileImageUrl: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  customerProfile: {
    select: {
      id: true,
      defaultAddressId: true,
      loyaltyPoints: true,
      totalShipments: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

// ─── Shared: issue token pair + persist refresh token ─────────────────────────

interface IssueTokensArgs {
  userId: string;
  role: Role;
  email: string;
  userAgent?: string;
  ipAddress?: string;
}

const issueTokens = async ({
  userId,
  role,
  email,
  userAgent,
  ipAddress,
}: IssueTokensArgs) => {
  const accessToken = signAccessToken({ sub: userId, role, email });

  const rawRefreshToken = generateRawRefreshToken();
  const tokenHash = await hashRefreshToken(rawRefreshToken);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt: refreshTokenExpiresAt(),
    },
  });

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn: 900, // 15 min in seconds
  };
};

// ─── Register ─────────────────────────────────────────────────────────────────

export const registerCustomer = async (
  payload: RegisterInput,
  userAgent?: string,
  ipAddress?: string,
) => {
  const existingUser = await prisma.user.findUnique({
    where: { email: payload.email },
    select: { id: true },
  });

  if (existingUser) {
    throw ConflictError('An account with this email already exists', [
      { field: 'email', message: 'Email is already registered', code: 'EMAIL_EXISTS' },
    ]);
  }

  const passwordHash = await bcrypt.hash(payload.password, PASSWORD_HASH_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: payload.email,
      passwordHash,
      name: payload.name,
      phone: payload.phone,
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
      customerProfile: { create: {} },
    },
    select: authUserSelect,
  });

  const tokens = await issueTokens({
    userId: user.id,
    role: user.role as Role,
    email: user.email,
    userAgent,
    ipAddress,
  });

  return { user, ...tokens };
};

// ─── Login ────────────────────────────────────────────────────────────────────

export const loginUser = async (
  payload: LoginInput,
  userAgent?: string,
  ipAddress?: string,
) => {
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      status: true,
      role: true,
    },
  });

  if (!user?.passwordHash) {
    throw UnauthorizedError('Invalid email or password');
  }

  const isPasswordValid = await bcrypt.compare(payload.password, user.passwordHash);

  if (!isPasswordValid) {
    throw UnauthorizedError('Invalid email or password');
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw ForbiddenError('Your account is not active');
  }

  // Update lastLoginAt and fetch full profile in one query
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
    select: authUserSelect,
  });

  const tokens = await issueTokens({
    userId: user.id,
    role: user.role as Role,
    email: user.email,
    userAgent,
    ipAddress,
  });

  return { user: updatedUser, ...tokens };
};

// ─── Refresh token rotation ───────────────────────────────────────────────────

export const rotateRefreshToken = async (
  rawToken: string,
  userAgent?: string,
  ipAddress?: string,
) => {
  // Find all non-revoked, non-expired tokens for candidate matching.
  // We search by userId later; first we need to find which stored hash matches.
  // Strategy: findMany recent tokens for active users, compare hash.
  // More efficient: store tokens indexed by userId — fetch candidates, compare.
  // Since bcrypt compare is slow, limit candidates (non-revoked, non-expired).
  const candidates = await prisma.refreshToken.findMany({
    where: {
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    take: 500, // safety cap
    select: {
      id: true,
      tokenHash: true,
      userId: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
        },
      },
    },
  });

  // Find the one whose hash matches the raw token
  let matched: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    const isMatch = await verifyRefreshTokenHash(rawToken, candidate.tokenHash);
    if (isMatch) {
      matched = candidate;
      break;
    }
  }

  if (!matched) {
    throw UnauthorizedError('Invalid or expired refresh token');
  }

  if (matched.user.status !== UserStatus.ACTIVE) {
    throw ForbiddenError('Your account is not active');
  }

  // Revoke the old token (mark rotatedTo for audit)
  const newRaw = generateRawRefreshToken();
  const newHash = await hashRefreshToken(newRaw);
  const newExpiresAt = refreshTokenExpiresAt();

  // Create new token first so we have its id for rotatedTo reference
  const newToken = await prisma.refreshToken.create({
    data: {
      userId: matched.userId,
      tokenHash: newHash,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt: newExpiresAt,
    },
  });

  // Revoke old, record rotation chain
  await prisma.refreshToken.update({
    where: { id: matched.id },
    data: {
      revokedAt: new Date(),
      rotatedTo: newToken.id,
    },
  });

  const accessToken = signAccessToken({
    sub: matched.userId,
    role: matched.user.role as Role,
    email: matched.user.email,
  });

  return {
    accessToken,
    refreshToken: newRaw,
    expiresIn: 900,
  };
};

// ─── Logout ───────────────────────────────────────────────────────────────────

/**
 * Revoke the refresh token that matches `rawToken`.
 * If `userId` is provided, the search is scoped to that user (faster).
 * When the full auth middleware (Step 10) is in place, callers can pass req.user.id.
 * Until then (or when called without auth), the service searches globally.
 */
export const logoutUser = async (rawToken: string, userId?: string) => {
  const where = {
    ...(userId ? { userId } : {}),
    revokedAt: null,
    expiresAt: { gt: new Date() },
  };

  const candidates = await prisma.refreshToken.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, tokenHash: true },
  });

  for (const candidate of candidates) {
    const isMatch = await verifyRefreshTokenHash(rawToken, candidate.tokenHash);
    if (isMatch) {
      await prisma.refreshToken.update({
        where: { id: candidate.id },
        data: { revokedAt: new Date() },
      });
      return;
    }
  }
  // Token not found or already revoked — idempotent, treat as success
};

// ─── Google OAuth callback ────────────────────────────────────────────────────

/**
 * Handle the Google OAuth callback after the user consents.
 * Three paths:
 *  1. User exists by googleSubject  → issue tokens directly
 *  2. User exists by email          → link googleSubject, then issue tokens
 *  3. No user found                 → auto-create CUSTOMER, then issue tokens
 */
export const googleOAuthCallback = async (
  profile: GoogleProfile,
  userAgent?: string,
  ipAddress?: string,
) => {
  // Path 1: existing user matched by googleSubject
  let user = await prisma.user.findUnique({
    where: { googleSubject: profile.sub },
    select: authUserSelect,
  });

  if (!user) {
    // Path 2: existing user matched by email — link the Google account
    const existingByEmail = await prisma.user.findUnique({
      where: { email: profile.email.toLowerCase() },
      select: { id: true },
    });

    if (existingByEmail) {
      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          googleSubject: profile.sub,
          profileImageUrl: profile.picture ?? undefined,
          lastLoginAt: new Date(),
        },
        select: authUserSelect,
      });
    } else {
      // Path 3: brand-new user — auto-create CUSTOMER with random unusable password
      const randomPassword = randomBytes(32).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, PASSWORD_HASH_ROUNDS);

      user = await prisma.user.create({
        data: {
          email: profile.email.toLowerCase(),
          passwordHash,
          googleSubject: profile.sub,
          name: profile.name,
          role: Role.CUSTOMER,
          status: UserStatus.ACTIVE,
          profileImageUrl: profile.picture ?? undefined,
          customerProfile: { create: {} },
        },
        select: authUserSelect,
      });
    }
  } else {
    // Path 1: update lastLoginAt
    user = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: authUserSelect,
    });
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw ForbiddenError('Your account is not active');
  }

  const tokens = await issueTokens({
    userId: user.id,
    role: user.role as Role,
    email: user.email,
    userAgent,
    ipAddress,
  });

  return { user, ...tokens };
};
