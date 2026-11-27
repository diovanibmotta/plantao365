import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HealthStatus } from '@diovanibmotta/plantao365-shared';
import { pingDb, type Sql } from './db.js';
import {
  createAuthRouter,
  csrfProtection,
  guestGuard,
  requireRole,
  sessionMiddleware,
  type AuthOptions,
  type OidcProvider,
} from './auth/index.js';
import { createAuditRouter } from './audit/index.js';
import { createBalanceRouter } from './balance/index.js';
import { createOnPublished, createOnShiftChanged } from './notifications/schedule-events.js';
import {
  createPluginAssetsRouter,
  createPluginsRouter,
  type PluginRegistry,
} from './plugins/index.js';
import { createPreferencesRouter } from './preferences/index.js';
import { createHolidaysRouter, createOnShiftsRecalculated } from './holidays/index.js';
import {
  countPublishedShiftsOnDates,
  createSchedulesRouter,
  findPublishedShiftsForUser,
} from './schedules/index.js';
import {
  createScheduleImpactNotifier,
  impactConfirmationResponse,
} from './schedule-impact/index.js';
import { createOnSwapEvent } from './notifications/swap-events.js';
import { createSwapsRouter } from './swaps/index.js';
import { createSystemRouter, type ConfigWarning } from './system/index.js';
import { createTeamsRouter, teamMiddleware } from './teams/index.js';
import { createUnavailabilityRouter } from './unavailability/index.js';
import { createUsersRouter } from './users/index.js';
import { mountWeb } from './web.js';
import type { Logger } from './logger.js';

export interface AppDeps {
  logger: Logger;
  db?: Sql;
  authOptions?: AuthOptions;
  allowedOrigins?: string[];
  /** Pasta do build do front; quando definida, a API também serve a SPA (imagem única). */
  webDistDir?: string;
  /** Origens do front em outro domínio: habilita CORS com credenciais e as aceita no CSRF. */
  corsOrigins?: string[];
  /** IdP injetado (testes); por padrão usa o Entra ID conforme authOptions. */
  oidcProvider?: OidcProvider;
  /** Recursos desativados por falta de configuração; exibidos como banner ao gestor. */
  configWarnings?: ConfigWarning[];
  /** Kernel de plugins: administração em /api/plugins e rotas em /api/extensions/<id>. */
  plugins?: PluginRegistry;
  /** Token aceito pela CLI no install de plugins. */
  pluginInstallToken?: string;
}

export function createApp({
  logger,
  db,
  authOptions,
  allowedOrigins,
  webDistDir,
  corsOrigins = [],
  oidcProvider,
  configWarnings = [],
  plugins,
  pluginInstallToken,
}: AppDeps): Hono {
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
    const confirmation = impactConfirmationResponse(err, c);
    if (confirmation) return confirmation;
    logger.error({ err, method: c.req.method, path: c.req.path }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  if (db && authOptions) {
    const csrfOrigins = [
      ...(allowedOrigins ?? [new URL(authOptions.appBaseUrl).origin]),
      ...corsOrigins,
    ];
    if (corsOrigins.length > 0) {
      app.use(
        cors({
          origin: corsOrigins,
          credentials: true,
          allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          allowHeaders: ['Content-Type', 'Accept', 'X-Requested-With'],
          maxAge: 600,
        }),
      );
    }
    app.use(csrfProtection({ allowedOrigins: csrfOrigins }));
    app.route(
      '/',
      createAuthRouter({
        db,
        logger,
        options: authOptions,
        ...(oidcProvider && { provider: oidcProvider }),
      }),
    );
    app.use(sessionMiddleware({ db, cookieOptions: { secure: authOptions.cookieSecure } }));
    app.use(
      '/api/*',
      guestGuard(plugins ? { extraReadPaths: () => plugins.guestReadPaths() } : {}),
    );
    app.use('/api/*', teamMiddleware({ db }));
    // Antes dos demais: o router de escalas registra `use('*', requireAuth())` sob /api, o que
    // barraria o install por token da CLI (sem sessão) em /api/plugins.
    if (plugins) {
      app.route(
        '/api',
        createPluginsRouter({
          registry: plugins,
          ...(pluginInstallToken && { installToken: pluginInstallToken }),
        }),
      );
      app.route('/', createPluginAssetsRouter({ registry: plugins }));
    }
    app.route('/api', createTeamsRouter({ db }));
    app.route('/api', createSystemRouter({ warnings: configWarnings }));
    app.route('/api', createAuditRouter({ db, guard: requireRole('manager') }));
    app.route(
      '/api',
      createUsersRouter({
        db,
        futureShiftsFinder: findPublishedShiftsForUser,
        appBaseUrl: authOptions.appBaseUrl,
      }),
    );
    const notifyDeps = { db, appBaseUrl: authOptions.appBaseUrl, logger };
    const scheduleImpactNotifier = createScheduleImpactNotifier();
    app.route(
      '/api',
      createHolidaysRouter({
        db,
        impactChecker: (sql, dates) => countPublishedShiftsOnDates(sql, dates),
        onShiftsRecalculated: createOnShiftsRecalculated(notifyDeps),
        scheduleImpactNotifier,
        logger,
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
        collectiveImpactChecker: (sql, dates, teamId) =>
          countPublishedShiftsOnDates(sql, dates, teamId),
        scheduleImpactNotifier,
      }),
    );
    app.route(
      '/api',
      createSchedulesRouter({
        db,
        onPublished: createOnPublished(notifyDeps),
        onShiftChanged: createOnShiftChanged(notifyDeps),
        scheduleImpactNotifier,
        ...(plugins && { rotationAdjusters: plugins.rotationAdjusters }),
        logger,
      }),
    );
    app.route(
      '/api',
      createSwapsRouter({
        db,
        onSwapEvent: createOnSwapEvent(notifyDeps),
        ...(plugins && { swapGuard: plugins.swapGuard }),
      }),
    );
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

  if (webDistDir) mountWeb(app, webDistDir);

  return app;
}
