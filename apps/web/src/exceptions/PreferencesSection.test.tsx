// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { PreferencesSection } from './PreferencesSection';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const prefs = (avoidWeekdays: number[], maxConsecutiveShifts: number | null) => ({
  preferences: { userId: 'u1', avoidWeekdays, maxConsecutiveShifts },
});

afterEach(() => {
  cleanup();
  toast.clear();
  vi.unstubAllGlobals();
});

describe('preferências do membro', () => {
  it('carrega e salva com PUT /api/me/preferences', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'PUT' ? json(prefs([0, 6], 3)) : json(prefs([0], null))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <>
        <PreferencesSection />
        <ToastViewport />
      </>,
    );
    const sunday = await screen.findByLabelText('Domingo');
    expect((sunday as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Sábado') as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByLabelText('Sábado'));
    await user.type(screen.getByLabelText(/Máximo de plantões/), '3');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('status')).textContent).toBe('Preferências salvas.');
    const call = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')!;
    expect(call[0]).toBe('/api/me/preferences');
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      avoidWeekdays: [0, 6],
      maxConsecutiveShifts: 3,
    });
  });

  it('envia null quando o máximo fica vazio e valida o intervalo', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(prefs([], 5))));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <>
        <PreferencesSection />
        <ToastViewport />
      </>,
    );
    const input = (await screen.findByLabelText(/Máximo de plantões/)) as HTMLInputElement;
    expect(input.value).toBe('5');
    fireEvent.change(input, { target: { value: '15' } });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('entre 1 e 14');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Preferências salvas.');
    const body = JSON.parse(
      String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.maxConsecutiveShifts).toBeNull();
  });

  it('mostra erro de carregamento e de salvamento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ error: 'x', message: 'Falha no servidor' }, 500))),
    );
    render(
      <>
        <PreferencesSection />
        <ToastViewport />
      </>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('Falha no servidor');
    cleanup();

    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'PUT'
            ? json({ error: 'x', message: 'Recusado' }, 400)
            : json(prefs([], null)),
        ),
      ),
    );
    const user = userEvent.setup();
    render(
      <>
        <PreferencesSection />
        <ToastViewport />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Recusado');
  });
});
