import nodemailer from 'nodemailer';
import type { Logger } from '../logger.js';
import type { Mailer, OutgoingEmail, SendContext, SmtpOptions } from './types.js';

/** Mascara o endereço (a***@dominio) para logs; o assunto não é registrado (pode conter PII). */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '***';
  return `${address[0]}***${address.slice(at)}`;
}

/** Mailer que apenas registra em log; útil em desenvolvimento sem SMTP. */
export function createDisabledMailer(logger: Logger): Mailer {
  return {
    kind: 'disabled',
    async send(message, context?: SendContext) {
      logger.info(
        { emailId: context?.emailId, to: maskEmail(message.to) },
        'SMTP não configurado: e-mail apenas registrado em log',
      );
    },
    close() {},
  };
}

export function createSmtpMailer(options: SmtpOptions): Mailer {
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure ?? options.port === 465,
    auth: options.user ? { user: options.user, pass: options.password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    kind: 'smtp',
    async send(message: OutgoingEmail) {
      await transport.sendMail({
        from: options.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    },
    close() {
      transport.close();
    },
  };
}

/** Usa SMTP quando há opções; caso contrário, o mailer desabilitado. */
export function createMailer(options: SmtpOptions | undefined, logger: Logger): Mailer {
  return options ? createSmtpMailer(options) : createDisabledMailer(logger);
}
