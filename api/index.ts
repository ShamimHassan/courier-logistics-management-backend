/**
 * Vercel serverless entry point.
 * All requests are delegated to Express, which handles routing including
 * the root "/" → "/api/v1" redirect.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import app from '../src/app';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const originalUrl = req.url ?? '/';
  const queryIndex = originalUrl.indexOf('?');
  const pathname = queryIndex === -1 ? originalUrl : originalUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : originalUrl.slice(queryIndex);

  let newPathname = pathname;

  if (pathname.startsWith('/api/index.ts')) {
    newPathname = pathname.slice('/api/index.ts'.length) || '/';
  } else if (pathname.startsWith('/api/index')) {
    newPathname = pathname.slice('/api/index'.length) || '/';
  }

  if (newPathname !== pathname) {
    req.url = newPathname + query;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app(req as any, res as any);
}
