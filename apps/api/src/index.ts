import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { bootstrapManagers, syncMasterUser, type AuthOptions } from './auth/index.js';
import { ConfigError, loadConfig } from './config.js';
import { createDb } from './db.js';
import { createMailer, startOutboxWorker, type SmtpOptions } from './email/index.js';
import { createLogger } from './logger.js';
import { startReminderJob } from './reminders/index.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}

const logger = createLogger({ level: config.LOG_LEVEL });
const db = createDb(config.DATABASE_URL);

const authOptions: AuthOptions = {
  appBaseUrl: config.APP_BASE_URL,
  cookieSecure: config.COOKIE_SECURE ?? config.NODE_ENV === 'production',
  sessionTtlSeconds: config.SESSION_TTL_SECONDS,
  oidc: {
    issuer: config.OIDC_ISSUER,
    clientId: config.OIDC_CLIENT_ID,
    clientSecret: config.OIDC_CLIENT_SECRET,
    redirectUri: config.OIDC_REDIRECT_URI,
  },
  master:
    config.MASTER_USERNAME && config.MASTER_PASSWORD
      ? { username: config.MASTER_USERNAME, password: config.MASTER_PASSWORD }
      : undefined,
};

const smtp: SmtpOptions | undefined =
  config.SMTP_HOST && config.SMTP_FROM
    ? {
        host: config.SMTP_HOST,
        port: config.SMTP_PORT ?? 587,
        user: config.SMTP_USER,
        password: config.SMTP_PASSWORD,
        from: config.SMTP_FROM,
        secure: config.SMTP_SECURE,
      }
    : undefined;

await bootstrapManagers(db, config.MANAGER_EMAILS);
await syncMasterUser(db, authOptions.master);
const mailer = createMailer(smtp, logger);
const worker = startOutboxWorker({ sql: db, mailer, logger });
const reminders = startReminderJob({ sql: db, logger, appBaseUrl: config.APP_BASE_URL });
const app = createApp({
  logger,
  db,
  authOptions,
  ...(config.WEB_DIST_DIR && { webDistDir: config.WEB_DIST_DIR }),
});

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'api listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void Promise.all([worker.stop(), reminders.stop()])
      .then(() => mailer.close())
      .then(() => db.end())
      .finally(() => process.exit(0));
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
