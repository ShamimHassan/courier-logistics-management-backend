import { z } from 'zod';

const bangladeshPhoneRegex = /^(?:\+8801|01)[3-9]\d{8}$/;
const uppercaseRegex = /[A-Z]/;
const numberRegex = /\d/;
const symbolRegex = /[^A-Za-z0-9]/;

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const normalizePhone = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.startsWith('01') ? `+880${trimmed.slice(1)}` : trimmed;
};

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters'),
  email: z.string().trim().email('Email must be valid').transform(normalizeEmail),
  phone: z
    .string()
    .trim()
    .regex(bangladeshPhoneRegex, 'Phone must be a valid Bangladesh mobile number')
    .transform(normalizePhone),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .refine((v) => uppercaseRegex.test(v), 'Password must contain at least one uppercase letter')
    .refine((v) => numberRegex.test(v), 'Password must contain at least one number')
    .refine((v) => symbolRegex.test(v), 'Password must contain at least one symbol'),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Email must be valid').transform(normalizeEmail),
  password: z.string().min(1, 'Password is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
