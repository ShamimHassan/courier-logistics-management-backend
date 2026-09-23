import Redis from 'ioredis';
import { env } from './env';

// ─── Redis client (optional) ──────────────────────────────────────────────────
// When REDIS_URL is not configured, all cache operations are silent no-ops.
// This keeps dev/test environments working without Redis installed.

let redisClient: Redis | null = null;

if (env.REDIS_URL) {
  try {
    redisClient = new Redis(env.REDIS_URL, {
      lazyConnect:         true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue:   false,
      connectTimeout:       5_000,
    });

    redisClient.on('error', (err) => {
      // Log but don't crash — cache is best-effort
      console.warn('[Redis] connection error (cache disabled):', err.message);
    });

    redisClient.on('connect', () => {
      console.log('  🔴 Redis connected:', env.REDIS_URL!.split('@').pop());
    });
  } catch {
    console.warn('[Redis] failed to initialise — caching disabled');
    redisClient = null;
  }
} else {
  console.log('  ℹ️  REDIS_URL not set — in-memory cache disabled (set REDIS_URL to enable)');
}

export { redisClient };

// ─── TTLs ─────────────────────────────────────────────────────────────────────

export const CACHE_TTL = {
  TRACKING:     30,         // 30 seconds — tracking timeline
  HUBS_LIST:    5 * 60,     // 5 minutes  — hub listing
  ZONES_LIST:   5 * 60,     // 5 minutes  — zone listing
  PRICING_LIST: 5 * 60,     // 5 minutes  — pricing rules
} as const;

// ─── Cache helpers ────────────────────────────────────────────────────────────

/** Get a cached value. Returns null if cache miss or Redis unavailable. */
export const cacheGet = async <T>(key: string): Promise<T | null> => {
  if (!redisClient) return null;
  try {
    const raw = await redisClient.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

/** Set a cached value with a TTL in seconds. Silently fails if Redis unavailable. */
export const cacheSet = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  if (!redisClient) return;
  try {
    await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // Silent fail — cache is best-effort
  }
};

/** Delete one or more cache keys. */
export const cacheDel = async (...keys: string[]): Promise<void> => {
  if (!redisClient || keys.length === 0) return;
  try {
    await redisClient.del(...keys);
  } catch {
    // Silent fail
  }
};

// ─── Cache key factories ──────────────────────────────────────────────────────

export const cacheKeys = {
  shipmentTracking: (shipmentId: string) => `shipment:${shipmentId}:tracking`,
  hubsList:         (query: string)       => `hubs:list:${query}`,
  hubById:          (hubId: string)       => `hub:${hubId}`,
  zonesList:        ()                    => 'zones:list',
  pricingList:      ()                    => 'pricing:list',
};
