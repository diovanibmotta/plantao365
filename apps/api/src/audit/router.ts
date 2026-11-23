import { Hono, type MiddlewareHandler } from 'hono';
import type { Sql } from '../db.js';
import { auditFiltersSchema, listAudit } from './service.js';

export interface AuditRouterDeps {
  db: Sql;
  guard: MiddlewareHandler;
}

export function createAuditRouter({ db, guard }: AuditRouterDeps): Hono {
  if (typeof guard !== 'function') {
    throw new Error(
      'createAuditRouter exige um guard: a auditoria nunca é exposta sem autorização',
    );
  }
  const router = new Hono();
  router.use('*', guard);

  router.get('/audit', async (c) => {
    const parsed = auditFiltersSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        {
          error: 'invalid_filters',
          message: 'Filtros de auditoria inválidos',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        400,
      );
    }
    return c.json(await listAudit(db, parsed.data));
  });

  return router;
}
