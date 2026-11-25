// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { MemoryRouter } from 'react-router';
import { ProfilePage as Page } from './ProfilePage';
import type { Profile } from '../profile/types';

vi.mock('../exceptions/PreferencesSection', () => ({
  PreferencesSection: () => <p>seção de preferências</p>,
}));
vi.mock('../exceptions/ExceptionsSection', () => ({
  ExceptionsSection: () => <p>seção de exceções</p>,
}));

const profile: Profile = {
  id: '1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  phone: '11 99999-0000',
  badgeNumber: null,
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
  toast.clear();
  vi.unstubAllGlobals();
});

const ProfilePage = () => (
  <MemoryRouter>
    <Page />
  </MemoryRouter>
);

describe('tela de perfil', () => {
  it('mostra dados protegidos somente leitura e campos editáveis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(profile))),
    );
    render(
      <>
        <ProfilePage />
        <ToastViewport />
      </>,
    );
    expect(await screen.findByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(screen.getByText('Membro')).toBeTruthy();
    expect(screen.getByText('Ativo')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /nome|e-mail/i })).toBeNull();
    expect((screen.getByLabelText(/Telefone/) as HTMLInputElement).value).toBe('11 99999-0000');
    expect((screen.getByLabelText(/lembretes/i) as HTMLInputElement).checked).toBe(true);
  });

  it('separa perfil, preferências e exceções em abas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(profile))),
    );
    const user = userEvent.setup();
    render(<ProfilePage />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Perfil', 'Preferências', 'Exceções']);
    expect(screen.queryByText('seção de exceções')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Preferências' }));
    expect(screen.getByText('seção de preferências')).toBeTruthy();
    expect(screen.queryByLabelText(/Telefone/)).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Exceções' }));
    expect(screen.getByText('seção de exceções')).toBeTruthy();
  });

  it('mostra a foto do Entra ID e cai para as iniciais sem foto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(profile))),
    );
    const { container } = render(<ProfilePage />);
    await screen.findByText('Ana Souza');
    const img = container.querySelector('.profile-avatar img')!;
    expect(img.getAttribute('src')).toBe('/api/users/1/photo');
    fireEvent.error(img);
    expect(container.querySelector('.profile-avatar')!.textContent).toBe('AS');
    expect(container.querySelector('.profile-avatar img')).toBeNull();
  });

  it('salva telefone e preferência com PATCH /api/me', async () => {
    const saved = {
      ...profile,
      phone: '11 98888-7777',
      badgeNumber: 'C-123',
      remindersEnabled: false,
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'PATCH' ? json(saved) : json(profile)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <>
        <ProfilePage />
        <ToastViewport />
      </>,
    );
    const phone = await screen.findByLabelText(/Telefone/);
    await user.clear(phone);
    await user.type(phone, '11 98888-7777');
    await user.type(screen.getByLabelText(/Crachá/), 'C-123');
    await user.click(screen.getByLabelText(/lembretes/i));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Perfil salvo.')).toBeTruthy();
    const call = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
    expect(call[0]).toBe('/api/me');
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      phone: '11 98888-7777',
      badgeNumber: 'C-123',
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
    render(
      <>
        <ProfilePage />
        <ToastViewport />
      </>,
    );
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
    render(
      <>
        <ProfilePage />
        <ToastViewport />
      </>,
    );
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
    render(
      <>
        <ProfilePage />
        <ToastViewport />
      </>,
    );
    await screen.findByLabelText(/Telefone/);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Telefone inválido'));
  });

  it('mostra erro de carregamento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ message: 'falhou' }, 500))),
    );
    render(
      <>
        <ProfilePage />
        <ToastViewport />
      </>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('falhou');
  });
});
