/**
 * Manual Google OAuth 2.0 flow — no extra library required (Node 18+ fetch).
 *
 * Flow:
 *  1. GET /auth/google          → redirect to Google consent screen
 *  2. GET /auth/google/callback → exchange `code` for tokens, fetch profile, issue JWT pair
 */

import { env } from '../../config/env';
import { AppError, BadRequestError } from '../../common/errors/AppError';

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GoogleProfile {
  sub: string;        // googleSubject — unique across all Google accounts
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Throws a 501 if GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL
 * are not configured. Keeps individual route handlers clean.
 */
export const assertGoogleConfigured = (): {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
} => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    throw new AppError(
      'Google OAuth is not configured on this server',
      501,
      [{ code: 'GOOGLE_NOT_CONFIGURED', message: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL' }],
    );
  }
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackUrl: GOOGLE_CALLBACK_URL,
  };
};

// ─── Step 1: Build the Google consent screen URL ──────────────────────────────

export const buildGoogleAuthUrl = (state?: string): string => {
  const { clientId, callbackUrl } = assertGoogleConfigured();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    ...(state ? { state } : {}),
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
};

// ─── Step 2: Exchange authorization code for profile ─────────────────────────

export const exchangeCodeForProfile = async (code: string): Promise<GoogleProfile> => {
  const { clientId, clientSecret, callbackUrl } = assertGoogleConfigured();

  // Exchange code for access token
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw BadRequestError('Failed to exchange Google authorization code', [
      { code: 'GOOGLE_TOKEN_EXCHANGE_FAILED', message: body.slice(0, 200) },
    ]);
  }

  const tokenData = (await tokenRes.json()) as GoogleTokenResponse;

  // Fetch user profile using access token
  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!profileRes.ok) {
    throw BadRequestError('Failed to fetch Google user profile', [
      { code: 'GOOGLE_PROFILE_FETCH_FAILED', message: 'Could not retrieve user info from Google' },
    ]);
  }

  const profile = (await profileRes.json()) as GoogleProfile;

  if (!profile.email_verified) {
    throw BadRequestError('Google account email is not verified', [
      { field: 'email', code: 'GOOGLE_EMAIL_NOT_VERIFIED', message: 'Only verified Google email addresses are accepted' },
    ]);
  }

  return profile;
};
