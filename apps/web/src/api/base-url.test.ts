import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBaseUrl, apiCredentials, apiUrl } from './base-url';
import { api } from './client';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('base da API', () => {
  it('sem VITE_API_BASE_URL usa caminho relativo e same-origin', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    expect(apiBaseUrl()).toBe('');
    expect(apiUrl('/api/x')).toBe('/api/x');
    expect(apiCredentials()).toBe('same-origin');
  });

  it('com VITE_API_BASE_URL prefixa o caminho e remove barra final', () => {
    vi.stubEnv('VITE_API_BASE_URL', ' https://api.example.com/ ');
    expect(apiUrl('/auth/login')).toBe('https://api.example.com/auth/login');
    expect(apiCredentials()).toBe('include');
  });

  it('o client chama a API na origem configurada com credenciais', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.post('/api/x', { a: 1 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/api/x');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe('include');
  });
});
