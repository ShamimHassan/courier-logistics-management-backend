import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production', 'staging']).default('development'),
  PORT: z.coerce.number().int().positive().min(1024).max(65535).default(5000),

  DATABASE_URL: z.string().url().startsWith('postgresql://', {
    message: 'DATABASE_URL must be a valid PostgreSQL connection string',
  }),
  DIRECT_URL: z
    .string()
    .url()
    .startsWith('postgresql://', {
      message: 'DIRECT_URL must be a valid PostgreSQL connection string',
    })
    .optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters long'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^sk_(test|live)_/, {
      message: 'STRIPE_SECRET_KEY must start with sk_test_ or sk_live_',
    })
    .optional(),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_/, {
      message: 'STRIPE_WEBHOOK_SECRET must start with whsec_',
    })
    .optional(),

  APP_BASE_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),

  REDIS_URL: z
    .string()
    .url()
    .refine(
      (url) => url.startsWith('redis://') || url.startsWith('rediss://'),
      'REDIS_URL must start with redis:// or rediss://',
    )
    .optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const issues = result.error.issues.map(
    (issue) => `  • ${issue.path.join('.')}: ${issue.message}`,
  );
  console.error(`❌ Invalid environment variables:\n${issues.join('\n')}`);
  process.exit(1);
}

export const env: Env = result.data;

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

export const getCorsOrigins = (): string[] => {
  return env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
};
