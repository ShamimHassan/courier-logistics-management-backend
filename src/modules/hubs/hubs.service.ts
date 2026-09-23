import { z } from 'zod';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../common/errors/AppError';
import { cacheGet, cacheDel, cacheKeys, cacheSet, CACHE_TTL } from '../../config/redis';

// ─── Validation ───────────────────────────────────────────────────────────────

export const listHubsSchema = z.object({
  zoneId:  z.string().cuid().optional(),
  status:  z.enum(['active', 'inactive', 'all']).optional().default('active'),
  page:    z.string().optional().transform((v) => Math.max(1, parseInt(v ?? '1',  10) || 1)),
  limit:   z.string().optional().transform((v) => Math.min(100, Math.max(1, parseInt(v ?? '20', 10) || 20))),
});

export const createHubSchema = z.object({
  name:             z.string().trim().min(2).max(200),
  code:             z.string().trim().toUpperCase().min(3).max(50),
  address:          z.string().trim().min(5).max(300),
  city:             z.string().trim().min(2).max(100),
  region:           z.string().trim().min(2).max(100),
  zip:              z.string().trim().max(20),
  originZoneId:     z.string().cuid().optional(),
  destinationZoneId: z.string().cuid().optional(),
  operatingHours:   z.string().trim().max(200).optional(),
  contactPhone:     z.string().trim().max(30).optional(),
  isActive:         z.boolean().default(true),
});

export const updateHubSchema = z.object({
  name:             z.string().trim().min(2).max(200).optional(),
  address:          z.string().trim().min(5).max(300).optional(),
  city:             z.string().trim().min(2).max(100).optional(),
  region:           z.string().trim().min(2).max(100).optional(),
  zip:              z.string().trim().max(20).optional(),
  operatingHours:   z.string().trim().max(200).optional().nullable(),
  contactPhone:     z.string().trim().max(30).optional().nullable(),
  isActive:         z.boolean().optional(),
  originZoneId:     z.string().cuid().optional().nullable(),
  destinationZoneId: z.string().cuid().optional().nullable(),
}).strict();

export type ListHubsQuery  = z.infer<typeof listHubsSchema>;
export type CreateHubInput = z.infer<typeof createHubSchema>;
export type UpdateHubInput = z.infer<typeof updateHubSchema>;

// ─── Prisma select ─────────────────────────────────────────────────────────────

const hubSelect = {
  id: true, name: true, code: true, address: true,
  city: true, region: true, zip: true,
  operatingHours: true, contactPhone: true, isActive: true,
  createdAt: true, updatedAt: true,
  originZone:      { select: { id: true, name: true, code: true } },
  destinationZone: { select: { id: true, name: true, code: true } },
} as const;

// ─── GET /hubs ─────────────────────────────────────────────────────────────────

export const listHubs = async (query: ListHubsQuery) => {
  const { zoneId, status, page, limit } = query;
  const skip = (page - 1) * limit;

  const cacheKey = cacheKeys.hubsList(`${zoneId ?? 'all'}-${status}-${page}-${limit}`);
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const where: Record<string, unknown> = { deletedAt: null };
  if (status === 'active')   where.isActive = true;
  if (status === 'inactive') where.isActive = false;
  if (zoneId) {
    where.OR = [{ originZoneId: zoneId }, { destinationZoneId: zoneId }];
  }

  const [totalCount, hubs] = await Promise.all([
    prisma.hub.count({ where }),
    prisma.hub.findMany({
      where,
      select: hubSelect,
      orderBy: { city: 'asc' },
      skip,
      take: limit,
    }),
  ]);

  const result = {
    hubs,
    meta: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
  };

  await cacheSet(cacheKey, result, CACHE_TTL.HUBS_LIST);
  return result;
};

// ─── GET /hubs/:id ─────────────────────────────────────────────────────────────

export const getHubById = async (hubId: string) => {
  const cacheKey = cacheKeys.hubById(hubId);
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const hub = await prisma.hub.findUnique({
    where: { id: hubId, deletedAt: null },
    select: hubSelect,
  });
  if (!hub) throw NotFoundError('Hub not found');

  await cacheSet(cacheKey, hub, CACHE_TTL.HUBS_LIST);
  return hub;
};

// ─── POST /admin/hubs ─────────────────────────────────────────────────────────

export const createHub = async (input: CreateHubInput) => {
  const hub = await prisma.hub.create({
    data: {
      name:              input.name,
      code:              input.code,
      address:           input.address,
      city:              input.city,
      region:            input.region,
      zip:               input.zip,
      originZoneId:      input.originZoneId      ?? null,
      destinationZoneId: input.destinationZoneId ?? null,
      operatingHours:    input.operatingHours    ?? null,
      contactPhone:      input.contactPhone      ?? null,
      isActive:          input.isActive,
    },
    select: hubSelect,
  });
  // Invalidate list cache on write
  await cacheDel(cacheKeys.hubsList('all-active-1-20'));
  return hub;
};

// ─── PATCH /admin/hubs/:id ────────────────────────────────────────────────────

export const updateHub = async (hubId: string, input: UpdateHubInput) => {
  const existing = await prisma.hub.findUnique({
    where: { id: hubId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw NotFoundError('Hub not found');

  const hub = await prisma.hub.update({
    where: { id: hubId },
    data: {
      ...(input.name            !== undefined ? { name:              input.name }            : {}),
      ...(input.address         !== undefined ? { address:           input.address }         : {}),
      ...(input.city            !== undefined ? { city:              input.city }            : {}),
      ...(input.region          !== undefined ? { region:            input.region }          : {}),
      ...(input.zip             !== undefined ? { zip:               input.zip }             : {}),
      ...(input.operatingHours  !== undefined ? { operatingHours:    input.operatingHours }  : {}),
      ...(input.contactPhone    !== undefined ? { contactPhone:      input.contactPhone }    : {}),
      ...(input.isActive        !== undefined ? { isActive:          input.isActive }        : {}),
      ...(input.originZoneId    !== undefined ? { originZoneId:      input.originZoneId }    : {}),
      ...(input.destinationZoneId !== undefined ? { destinationZoneId: input.destinationZoneId } : {}),
    },
    select: hubSelect,
  });
  // Invalidate specific hub + list cache on write
  await cacheDel(cacheKeys.hubById(hubId));
  return hub;
};
