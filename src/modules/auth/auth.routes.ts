import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { loginUser, logoutUser, registerCustomer, rotateRefreshToken, googleOAuthCallback } from './auth.service';
import {
  loginSchema,
  logoutSchema,
  refreshTokenSchema,
  registerSchema,
} from './auth.validation';
import { assertGoogleConfigured, buildGoogleAuthUrl, exchangeCodeForProfile } from './auth.google';
import { authenticateOptional } from '../../common/middleware/authenticate';

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
// authenticate is optional here — if a valid token is present we scope the
// revocation to that user (faster). If not (e.g. expired access token), we
// still find and revoke the refresh token globally via the hash search.

router.post('/logout', authenticateOptional, async (req: Request, res: Response) => {
  const { refreshToken } = logoutSchema.parse(req.body);

  // req.user is set by authenticate when access token is valid;
  // logoutUser scopes search to that userId for efficiency.
  await logoutUser(refreshToken, req.user?.id);

  res.status(StatusCodes.OK).json(
    successResponse('Logged out successfully', null),
  );
});

// ─── Google OAuth: redirect to consent screen ────────────────────────────────

router.get('/google', (_req: Request, res: Response) => {
  // assertGoogleConfigured throws 501 if env vars are missing
  assertGoogleConfigured();
  const url = buildGoogleAuthUrl();
  res.redirect(302, url);
});

// ─── Google OAuth: callback ───────────────────────────────────────────────────

router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query as { code?: string; error?: string };

  // Google sends ?error=access_denied when the user cancels
  if (error) {
    res.status(StatusCodes.BAD_REQUEST).json(
      successResponse('Google OAuth cancelled', { error }),
    );
    return;
  }

  if (!code || typeof code !== 'string') {
    res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: 'Missing authorization code from Google',
      errors: [{ code: 'MISSING_CODE', message: 'No authorization code was provided' }],
    });
    return;
  }

  const profile = await exchangeCodeForProfile(code);
  const { user, accessToken, refreshToken, expiresIn } = await googleOAuthCallback(
    profile,
    req.get('user-agent'),
    req.ip,
  );

  res.status(StatusCodes.OK).json(
    successResponse('Google login successful', {
      user,
      accessToken,
      refreshToken,
      expiresIn,
    }),
  );
});

export default router;
