import { env } from './env';

/**
 * SSLCommerz base URLs
 * Sandbox:    https://sandbox.sslcommerz.com
 * Production: https://securepay.sslcommerz.com
 */
export const SSLCOMMERZ_BASE_URL =
  (env.SSLCOMMERZ_IS_SANDBOX || env.SSLCOMMERZ_SANDBOX === 'true')
    ? 'https://sandbox.sslcommerz.com'
    : 'https://securepay.sslcommerz.com';

/** SSLCommerz initiation endpoint */
export const SSLCOMMERZ_INIT_URL = `${SSLCOMMERZ_BASE_URL}/gwprocess/v4/api.php`;

/** SSLCommerz validation endpoint */
export const SSLCOMMERZ_VALIDATION_URL = `${SSLCOMMERZ_BASE_URL}/validator/api/validationserverAPI.php`;

export const getSSLCommerzCredentials = () => {
  const storeId  = env.SSLCOMMERZ_STORE_ID;
  const storePass = env.SSLCOMMERZ_STORE_PASSWORD;

  if (!storeId || !storePass) {
    throw new Error(
      'SSLCommerz credentials not configured. Set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD in .env',
    );
  }

  return { storeId, storePass };
};

// ─── Type definitions for SSLCommerz API responses ────────────────────────────

export interface SSLCommerzInitResponse {
  status: 'SUCCESS' | 'FAIL';
  failedreason?: string;
  sessionkey: string;
  GatewayPageURL: string;
  storeBanner?: string;
  storeLogo?: string;
  desc?: Array<{ name: string; type: string; logo: string; gw: string; r_flag: string; redirectGatewayURL: string }>;
}

export interface SSLCommerzValidationResponse {
  APIConnect: 'VALID' | 'INVALID';
  status: 'VALID' | 'VALIDATED' | 'INVALID' | 'FAILED' | 'CANCELLED';
  tran_id: string;
  val_id: string;
  amount: string;
  store_amount: string;
  currency: string;
  bank_tran_id: string;
  tran_date: string;
  error?: string;
}

export interface SSLCommerzIPNPayload {
  tran_id: string;
  val_id: string;
  amount: string;
  store_amount?: string;
  bank_tran_id?: string;
  status: string;
  tran_date?: string;
  error?: string;
  currency?: string;
  store_id?: string;
  verify_key?: string;
  verify_sign?: string;
  verify_sign_sha2?: string;
  [key: string]: string | undefined;
}
