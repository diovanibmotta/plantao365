import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, getToasts } from '../toast/toast-store';
import { api, ForbiddenError, NetworkError, UnauthorizedError } from './client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  toast.clear();
});

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

  describe('toasts em mutações', () => {
    const kinds = () => getToasts().map((t) => `${t.kind}:${t.message}`);

    it('não exibe toast em GET', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true })));
      await api.get('/api/x');
      expect(kinds()).toEqual([]);
    });

    it('exibe sucesso padrão por verbo e mensagem customizada', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.resolve(json({}))),
      );
      await api.delete('/api/x');
      await api.put('/api/x', {}, { successMessage: 'Salvo!' });
      expect(kinds()).toEqual(['success:Excluído com sucesso.', 'success:Salvo!']);
    });

    it('usa message/notice do corpo e emite avisos de warnings', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(json({ notice: 'Avisado.', warnings: [{ message: 'Conflito' }] })),
      );
      await api.patch('/api/x', {});
      expect(kinds()).toEqual(['success:Avisado.', 'warning:Conflito']);
    });

    it('exibe erro com message do corpo ou texto por status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ message: 'Falhou' }, 422)));
      await expect(api.post('/api/x', {})).rejects.toThrow('Falhou');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 500)));
      await expect(api.post('/api/y', {})).rejects.toThrow();
      expect(kinds()).toEqual(['error:Falhou', 'error:Erro interno do servidor. Tente novamente.']);
    });

    it('respeita silentSuccess, silentError e ignora 401', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({})));
      await api.post('/api/x', {}, { silentSuccess: true });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ error: 'confirmation' }, 409)));
      await expect(
        api.post('/api/x', {}, { silentError: (e) => e.status === 409 }),
      ).rejects.toThrow();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 401)));
      await expect(api.post('/api/x', {})).rejects.toBeInstanceOf(UnauthorizedError);
      expect(kinds()).toEqual([]);
    });

    it('exibe erro de rede', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('fail')));
      await expect(api.post('/api/x', {})).rejects.toBeInstanceOf(NetworkError);
      expect(kinds()).toEqual(['error:Não foi possível conectar ao servidor.']);
    });
  });
});
