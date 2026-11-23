import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createLogger } from './logger.js';

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      cb();
    },
  });
  const logs = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { destination, logs };
}

describe('API', () => {
  it('GET /health returns ok', async () => {
    const { destination } = capture();
    const app = createApp({ logger: createLogger({ destination }) });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready is ok when no database is configured', async () => {
    const { destination } = capture();
    const app = createApp({ logger: createLogger({ destination }) });
    const res = await app.request('/health/ready');
    expect(res.status).toBe(200);
  });

  it('logs each request as structured JSON with a request id', async () => {
    const { destination, logs } = capture();
    const app = createApp({ logger: createLogger({ destination }) });
    const res = await app.request('/health', { headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers.get('x-request-id')).toBe('abc-123');
    const entry = logs().find((l) => l['msg'] === 'request');
    expect(entry).toMatchObject({
      service: 'plantao360-api',
      requestId: 'abc-123',
      method: 'GET',
      path: '/health',
      status: 200,
    });
    expect(typeof entry?.['durationMs']).toBe('number');
    expect(typeof entry?.['time']).toBe('string');
  });

  it('turns unhandled errors into 500 and logs them', async () => {
    const { destination, logs } = capture();
    const app = createApp({ logger: createLogger({ destination }) });
    app.get('/boom', () => {
      throw new Error('boom');
    });
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
    expect(logs().some((l) => l['msg'] === 'unhandled error' && l['level'] === 50)).toBe(true);
  });
});
