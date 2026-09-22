import bcrypt from 'bcryptjs';
import { Role, UserStatus } from '../../../prisma/generated/client/enums';
import { prisma } from '../../config/database';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../../common/errors/AppError';
import type { LoginInput, RegisterInput } from './auth.validation';

const PASSWORD_HASH_ROUNDS = 12;

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

export const registerCustomer = async (payload: RegisterInput) => {
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

  return prisma.user.create({
    data: {
      email: payload.email,
      passwordHash,
      name: payload.name,
      phone: payload.phone,
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
      customerProfile: {
        create: {},
      },
    },
    select: authUserSelect,
  });
};

export const loginUser = async (payload: LoginInput) => {
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      status: true,
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

  return prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
    select: authUserSelect,
  });
};
