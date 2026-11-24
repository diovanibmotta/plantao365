// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilePage } from './ProfilePage';
import type { Profile } from '../profile/types';

vi.mock('../exceptions/PreferencesSection', () => ({ PreferencesSection: () => null }));
vi.mock('../exceptions/ExceptionsSection', () => ({ ExceptionsSection: () => null }));

const profile: Profile = {
  id: '1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  phone: '11 99999-0000',
  role: 'member',
  active: true,
  participatesInRotation: true,
  remindersEnabled: true,
  isMaster: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('tela de perfil', () => {
  it('mostra dados protegidos somente leitura e campos editáveis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(profile))),
    );
    render(<ProfilePage />);
    expect(await screen.findByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(screen.getByText('Membro')).toBeTruthy();
    expect(screen.getByText('Ativo')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /nome|e-mail/i })).toBeNull();
    expect((screen.getByLabelText(/Telefone/) as HTMLInputElement).value).toBe('11 99999-0000');
    expect((screen.getByLabelText(/lembretes/i) as HTMLInputElement).checked).toBe(true);
  });

  it('salva telefone e preferência com PATCH /api/me', async () => {
    const saved = { ...profile, phone: '11 98888-7777', remindersEnabled: false };
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'PATCH' ? json(saved) : json(profile)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ProfilePage />);
    const phone = await screen.findByLabelText(/Telefone/);
    await user.clear(phone);
    await user.type(phone, '11 98888-7777');
    await user.click(screen.getByLabelText(/lembretes/i));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Perfil salvo.')).toBeTruthy();
    const call = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
    expect(call[0]).toBe('/api/me');
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      phone: '11 98888-7777',
      remindersEnabled: false,
    });
    expect((screen.getByLabelText(/lembretes/i) as HTMLInputElement).checked).toBe(false);
  });

  it('envia phone null quando o telefone é esvaziado', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(json(init?.method === 'PATCH' ? { ...profile, phone: null } : profile)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ProfilePage />);
    await user.clear(await screen.findByLabelText(/Telefone/));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Perfil salvo.');
    const call = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
    expect(JSON.parse(String(call[1]?.body)).phone).toBeNull();
  });

  it('valida telefone no cliente sem chamar a API', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(profile)));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<ProfilePage />);
    const phone = await screen.findByLabelText(/Telefone/);
    await user.clear(phone);
    await user.type(phone, 'abc');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByText(/Telefone inválido/)).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(
        (c) =>
          (c as unknown[])[1] !== undefined && (c as [string, RequestInit])[1].method === 'PATCH',
      ),
    ).toHaveLength(0);
  });

  it('mostra o erro devolvido pela API ao salvar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'PATCH'
            ? json({ error: 'invalid_request', message: 'Telefone inválido' }, 400)
            : json(profile),
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ProfilePage />);
    await screen.findByLabelText(/Telefone/);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Telefone inválido'));
  });

  it('mostra erro de carregamento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ message: 'falhou' }, 500))),
    );
    render(<ProfilePage />);
    expect((await screen.findByRole('alert')).textContent).toBe('falhou');
  });
});
