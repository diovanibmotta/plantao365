import { SMTPServer } from 'smtp-server';
import type { SmtpOptions } from './types.js';

export interface CapturedEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  raw: string;
}

export interface TestSmtp {
  host: string;
  port: number;
  /** Opções prontas para createSmtpMailer. */
  options: SmtpOptions;
  messages: CapturedEmail[];
  /** Aguarda até haver `count` mensagens capturadas. */
  waitForMessages(count: number, timeoutMs?: number): Promise<CapturedEmail[]>;
  clear(): void;
  close(): Promise<void>;
}

function decodeQuotedPrintable(input: string): Buffer {
  const joined = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(joined[i]!, 'utf8'));
    }
  }
  return Buffer.from(bytes);
}

function decodeBody(body: string, encoding: string): string {
  switch (encoding.toLowerCase()) {
    case 'base64':
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    case 'quoted-printable':
      return decodeQuotedPrintable(body).toString('utf8');
    default:
      return body;
  }
}

function decodeHeaderWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_m, kind: string, data: string) =>
      kind.toLowerCase() === 'b'
        ? Buffer.from(data, 'base64').toString('utf8')
        : decodeQuotedPrintable(data.replaceAll('_', ' ')).toString('utf8'),
    );
}

function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) headers.set(line.slice(0, idx).toLowerCase(), line.slice(idx + 1).trim());
  }
  return headers;
}

interface Part {
  headers: Map<string, string>;
  type: string;
  content: string;
}

function parseEntity(source: string): Part[] {
  const split = source.search(/\r?\n\r?\n/);
  const headerBlock = split < 0 ? source : source.slice(0, split);
  const body = split < 0 ? '' : source.slice(source.indexOf('\n', split + 1) + 1);
  const headers = parseHeaders(headerBlock);
  const contentType = headers.get('content-type') ?? 'text/plain';
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (type.startsWith('multipart/') && boundary) {
    return body
      .split(`--${boundary}`)
      .slice(1)
      .filter((p) => !p.startsWith('--'))
      .flatMap((p) => parseEntity(p.replace(/^\r?\n/, '')));
  }
  const content = decodeBody(body, headers.get('content-transfer-encoding') ?? '7bit');
  return [{ headers, type, content }];
}

export function parseRawEmail(
  raw: string,
  envelope: { from: string; to: string[] },
): CapturedEmail {
  const headers = parseHeaders(raw.slice(0, raw.search(/\r?\n\r?\n/)));
  const parts = parseEntity(raw);
  const pick = (type: string) =>
    (parts.find((p) => p.type === type)?.content ?? '').replace(/\r\n/g, '\n').trimEnd();
  return {
    from: envelope.from,
    to: envelope.to,
    subject: decodeHeaderWords(headers.get('subject') ?? ''),
    html: pick('text/html'),
    text: pick('text/plain'),
    raw,
  };
}

/** Servidor SMTP em memória (porta aleatória em 127.0.0.1) que captura as mensagens recebidas. */
export async function startTestSmtp(): Promise<TestSmtp> {
  const messages: CapturedEmail[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        const from = session.envelope.mailFrom ? session.envelope.mailFrom.address : '';
        const to = session.envelope.rcptTo.map((r) => r.address);
        messages.push(parseRawEmail(Buffer.concat(chunks).toString('utf8'), { from, to }));
        callback();
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.server.address();
  if (address === null || typeof address === 'string') throw new Error('Porta SMTP indisponível');
  const { port } = address;

  return {
    host: '127.0.0.1',
    port,
    options: { host: '127.0.0.1', port, from: 'Plantão360 <plantao360@example.test>' },
    messages,
    async waitForMessages(count, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (messages.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`Esperava ${count} mensagem(ns), recebeu ${messages.length}`);
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      return messages;
    },
    clear() {
      messages.length = 0;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
