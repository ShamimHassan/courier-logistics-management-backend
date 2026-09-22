import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { loginUser, logoutUser, registerCustomer, rotateRefreshToken } from './auth.service';
import {
  loginSchema,
  logoutSchema,
  refreshTokenSchema,
  registerSchema,
} from './auth.validation';

const router = Router();

// ─── Register ─────────────────────────────────────────────────────────────────

router.post('/register', async (req: Request, res: Response) => {
  const payload = registerSchema.parse(req.body);
  const { user, accessToken, refreshToken, expiresIn } = await registerCustomer(
    payload,
    req.get('user-agent'),
    req.ip,
  );

  res.status(StatusCodes.CREATED).json(
    successResponse('Customer account created successfully', {
      user,
      accessToken,
      refreshToken,
      expiresIn,
    }),
  );
});

// ─── Login ────────────────────────────────────────────────────────────────────

router.post('/login', async (req: Request, res: Response) => {
  const payload = loginSchema.parse(req.body);
  const { user, accessToken, refreshToken, expiresIn } = await loginUser(
    payload,
    req.get('user-agent'),
    req.ip,
  );

  res.status(StatusCodes.OK).json(
    successResponse('Login successful', {
      user,
      accessToken,
      refreshToken,
      expiresIn,
    }),
  );
});

// ─── Refresh token rotation ───────────────────────────────────────────────────

router.post('/refresh-token', async (req: Request, res: Response) => {
  const { refreshToken } = refreshTokenSchema.parse(req.body);
  const tokens = await rotateRefreshToken(
    refreshToken,
    req.get('user-agent'),
    req.ip,
  );

  res.status(StatusCodes.OK).json(
    successResponse('Tokens refreshed successfully', tokens),
  );
});

// ─── Logout ───────────────────────────────────────────────────────────────────

router.post('/logout', async (req: Request, res: Response) => {
  const { refreshToken } = logoutSchema.parse(req.body);

  // Full authenticate middleware arrives in Step 10.
  // Until then, logoutUser searches globally by token hash (safe, idempotent).
  await logoutUser(refreshToken);

  res.status(StatusCodes.OK).json(
    successResponse('Logged out successfully', null),
  );
});

export default router;
