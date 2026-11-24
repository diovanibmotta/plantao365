import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

export interface LoggerOptions {
  level?: string;
  destination?: DestinationStream;
}

/** Logger JSON estruturado, com redação de campos sensíveis (RNF-7). */
export function createLogger({ level = 'info', destination }: LoggerOptions = {}): Logger {
  return pino(
    {
      level,
      base: { service: 'plantao365-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
        censor: '[redacted]',
      },
    },
    destination,
  );
}
