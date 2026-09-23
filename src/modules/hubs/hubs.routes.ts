import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import {
  createHub, createHubSchema,
  getHubById,
  listHubs, listHubsSchema,
  updateHub, updateHubSchema,
} from './hubs.service';

const router = Router();

// ─── GET /hubs — all authenticated roles ──────────────────────────────────────

router.get('/', authenticate, async (req: Request, res: Response) => {
  const query = listHubsSchema.parse(req.query);
  const result = await listHubs(query);
  res.status(StatusCodes.OK).json(successResponse('Hubs retrieved successfully', result));
});

// ─── GET /hubs/:id — all authenticated roles ─────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const hub = await getHubById(String(req.params.id));
  res.status(StatusCodes.OK).json(successResponse('Hub retrieved successfully', { hub }));
});

// ─── POST /hubs — ADMIN only ──────────────────────────────────────────────────

router.post('/', authenticate, authorize('ADMIN'), async (req: Request, res: Response) => {
  const input = createHubSchema.parse(req.body);
  const hub = await createHub(input);
  res.status(StatusCodes.CREATED).json(successResponse('Hub created successfully', { hub }));
});

// ─── PATCH /hubs/:id — ADMIN only ────────────────────────────────────────────

router.patch('/:id', authenticate, authorize('ADMIN'), async (req: Request, res: Response) => {
  const input = updateHubSchema.parse(req.body);
  const hub = await updateHub(String(req.params.id), input);
  res.status(StatusCodes.OK).json(successResponse('Hub updated successfully', { hub }));
});

export default router;
