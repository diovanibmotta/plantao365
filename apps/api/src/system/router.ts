import { Hono } from 'hono';
import { requireRole } from '../auth/authz.js';
import type { AuthEnv } from '../auth/types.js';
import type { ConfigWarning } from './warnings.js';

export interface SystemRouterDeps {
  warnings: ConfigWarning[];
}

export function createSystemRouter({ warnings }: SystemRouterDeps): Hono<AuthEnv> {
  const router = new Hono<AuthEnv>();
  router.get('/system/warnings', requireRole('manager'), (c) => c.json({ warnings }));
  return router;
}
