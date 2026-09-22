import { z } from 'zod';

const bangladeshPhoneRegex = /^(?:\+8801|01)[3-9]\d{8}$/;
const uppercaseRegex = /[A-Z]/;
const numberRegex   = /\d/;
const symbolRegex   = /[^A-Za-z0-9]/;

const normalizePhone = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.startsWith('01') ? `+880${trimmed.slice(1)}` : trimmed;
};

/**
 * PATCH /users/me — only safe fields allowed.
 * Deliberately omits: role, email, password, status, googleSubject.
 */
export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .optional(),
  phone: z
    .string()
    .trim()
    .regex(bangladeshPhoneRegex, 'Phone must be a valid Bangladesh mobile number')
    .transform(normalizePhone)
    .optional(),
  profileImageUrl: z
    .string()
    .trim()
    .url('Profile image must be a valid URL')
    .max(500, 'URL is too long')
    .optional()
    .nullable(),
}).strict(); // reject any unknown fields (role, email, status, etc.)

/**
 * PATCH /users/me/password
 * Both CUSTOMER and ADMIN roles.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .refine((v) => uppercaseRegex.test(v), 'New password must contain at least one uppercase letter')
    .refine((v) => numberRegex.test(v),    'New password must contain at least one number')
    .refine((v) => symbolRegex.test(v),    'New password must contain at least one symbol'),
}).refine(
  (data) => data.currentPassword !== data.newPassword,
  { message: 'New password must be different from the current password', path: ['newPassword'] },
);

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
