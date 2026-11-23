import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { HealthStatus } from '@plantao360/shared';
import { pingDb, type Sql } from './db.js';
import {
  createAuthRouter,
  csrfProtection,
  requireRole,
  sessionMiddleware,
  type AuthOptions,
} from './auth/index.js';
import { createAuditRouter } from './audit/index.js';
import { createBalanceRouter } from './balance/index.js';
import { createOnPublished, createOnShiftChanged } from './notifications/schedule-events.js';
import { createPreferencesRouter } from './preferences/index.js';
import { createHolidaysRouter, createOnShiftsRecalculated } from './holidays/index.js';
import {
  countPublishedShiftsOnDates,
  createSchedulesRouter,
  findPublishedShiftsForUser,
} from './schedules/index.js';
import { createOnUnavailabilityConflict } from './notifications/unavailability-events.js';
import { createOnSwapEvent } from './notifications/swap-events.js';
import { createSwapsRouter } from './swaps/index.js';
import { createUnavailabilityRouter } from './unavailability/index.js';
import { createUsersRouter } from './users/index.js';
import type { Logger } from './logger.js';

export interface AppDeps {
  logger: Logger;
  db?: Sql;
  authOptions?: AuthOptions;
  allowedOrigins?: string[];
}

export function createApp({ logger, db, authOptions, allowedOrigins }: AppDeps): Hono {
  const app = new Hono();

  app.use(async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    const started = performance.now();
    c.header('x-request-id', requestId);
    await next();
    logger.info(
      {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      'request',
    );
  });

  app.onError((err, c) => {
    logger.error({ err, method: c.req.method, path: c.req.path }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  if (db && authOptions) {
    app.use(
      csrfProtection({
        allowedOrigins: allowedOrigins ?? [new URL(authOptions.appBaseUrl).origin],
      }),
    );
    app.route('/', createAuthRouter({ db, logger, options: authOptions }));
    app.use(sessionMiddleware({ db, cookieOptions: { secure: authOptions.cookieSecure } }));
    app.route('/api', createAuditRouter({ db, guard: requireRole('manager') }));
    app.route('/api', createUsersRouter({ db, futureShiftsFinder: findPublishedShiftsForUser }));
    const notifyDeps = { db, appBaseUrl: authOptions.appBaseUrl, logger };
    app.route(
      '/api',
      createHolidaysRouter({
        db,
        impactChecker: (sql, dates) => countPublishedShiftsOnDates(sql, dates),
        onShiftsRecalculated: createOnShiftsRecalculated(notifyDeps),
      }),
    );
    app.route(
      '/api',
      createUnavailabilityRouter({
        db,
        logger,
        conflictChecker: async (sql, args) => {
          const rows = await findPublishedShiftsForUser(sql, args);
          return rows.flatMap((r) => (r.userId ? [{ date: r.date, userId: r.userId }] : []));
        },
        collectiveImpactChecker: (sql, dates) => countPublishedShiftsOnDates(sql, dates),
        onConflict: createOnUnavailabilityConflict(notifyDeps),
      }),
    );
    app.route(
      '/api',
      createSchedulesRouter({
        db,
        onPublished: createOnPublished(notifyDeps),
        onShiftChanged: createOnShiftChanged(notifyDeps),
      }),
    );
    app.route('/api', createSwapsRouter({ db, onSwapEvent: createOnSwapEvent(notifyDeps) }));
    app.route('/api', createPreferencesRouter({ db }));
    app.route('/api', createBalanceRouter({ db }));
  }

  app.get('/health', (c) => {
    const body: HealthStatus = { status: 'ok' };
    return c.json(body);
  });

  app.get('/health/ready', async (c) => {
    if (!db) return c.json({ status: 'ok', db: 'disabled' });
    const ok = await pingDb(db);
    return c.json({ status: ok ? 'ok' : 'unavailable', db: ok ? 'up' : 'down' }, ok ? 200 : 503);
  });

  return app;
}
