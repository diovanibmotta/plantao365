import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ForbiddenError, NetworkError, UnauthorizedError } from './client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('envia X-Requested-With em requisições não-GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await api.post('/api/x', { a: 1 });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('plantao360');
  });

  it('não envia X-Requested-With em GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal('fetch', fetchMock);
    await api.get('/api/x');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).not.toHaveProperty('X-Requested-With');
  });

  it('tipifica erros 401, 403 e de rede', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 401)));
    await expect(api.get('/a')).rejects.toBeInstanceOf(UnauthorizedError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 403)));
    await expect(api.get('/a')).rejects.toBeInstanceOf(ForbiddenError);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('fail')));
    await expect(api.get('/a')).rejects.toBeInstanceOf(NetworkError);
  });
});
