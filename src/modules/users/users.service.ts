import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../common/errors/AppError';
import type { ChangePasswordInput, UpdateProfileInput } from './users.validation';

const PASSWORD_HASH_ROUNDS = 12;

// ─── Prisma selects — passwordHash and refreshTokens never returned ───────────

/**
 * Full user select with role-specific profile join.
 * CustomerProfile and CourierProfile are both included; the client uses the
 * non-null one based on the `role` field.
 */
const fullUserSelect = {
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
  courierProfile: {
    select: {
      id: true,
      approvalStatus: true,
      vehicleType: true,
      vehiclePlateNumber: true,
      available: true,
      averageRating: true,
      totalRatings: true,
      totalDeliveries: true,
      totalEarnings: true,
      coverageRadiusKm: true,
      createdAt: true,
      updatedAt: true,
      serviceZones: {
        select: {
          id: true,
          isPrimary: true,
          assignedAt: true,
          zone: {
            select: { id: true, name: true, code: true, city: true, region: true },
          },
        },
      },
    },
  },
} as const;

// ─── GET /users/me ────────────────────────────────────────────────────────────

export const getMe = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: fullUserSelect,
  });

  if (!user) {
    throw NotFoundError('User not found');
  }

  return user;
};

// ─── PATCH /users/me ──────────────────────────────────────────────────────────

export const updateMe = async (userId: string, payload: UpdateProfileInput) => {
  // Only write fields that were actually provided (undefined = omit from update)
  const data: Record<string, unknown> = {};
  if (payload.name            !== undefined) data.name            = payload.name;
  if (payload.phone           !== undefined) data.phone           = payload.phone;
  if ('profileImageUrl' in payload)          data.profileImageUrl = payload.profileImageUrl;

  if (Object.keys(data).length === 0) {
    // Nothing to update — just return current profile
    return getMe(userId);
  }

  return prisma.user.update({
    where: { id: userId },
    data,
    select: fullUserSelect,
  });
};

// ─── PATCH /users/me/password ─────────────────────────────────────────────────

export const changePassword = async (userId: string, payload: ChangePasswordInput) => {
  // Fetch current hash — this is the ONLY time we touch passwordHash
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw NotFoundError('User not found');
  }

  // Google-only accounts have no password
  if (!user.passwordHash) {
    throw BadRequestError('This account uses Google sign-in and has no password to change', [
      { code: 'NO_PASSWORD', message: 'Use Google OAuth to authenticate' },
    ]);
  }

  const isCurrentValid = await bcrypt.compare(payload.currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    throw UnauthorizedError('Current password is incorrect', [
      { field: 'currentPassword', code: 'WRONG_PASSWORD', message: 'The current password you entered is incorrect' },
    ]);
  }

  const newHash = await bcrypt.hash(payload.newPassword, PASSWORD_HASH_ROUNDS);

  // Update password + invalidate ALL refresh tokens for this user (security best practice)
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { message: 'Password changed successfully. All sessions have been invalidated.' };
};
