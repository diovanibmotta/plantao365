export interface SmtpOptions {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  /** TLS implícito (porta 465). Por padrão, usa STARTTLS quando o servidor oferece. */
  secure?: boolean;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailMessage extends OutgoingEmail {
  /** Chave de idempotência: a mesma chave nunca é enfileirada duas vezes. */
  dedupeKey?: string;
  /** Quando o envio pode começar; por padrão, imediatamente. */
  notBefore?: Date;
}

/** Metadados não pessoais do envio (para logs). */
export interface SendContext {
  emailId?: string;
}

export interface Mailer {
  readonly kind: 'smtp' | 'disabled';
  send(message: OutgoingEmail, context?: SendContext): Promise<void>;
  close(): void;
}
