// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { HolidaysPage } from '../pages/HolidaysPage';
import type { Holiday } from './types';
import { formatHolidayDate, warningMessage } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const holiday = (id: string, date: string, name: string, scope: Holiday['scope'] = 'national') => ({
  id,
  date,
  name,
  scope,
});

const NATAL = holiday('h2', '2026-12-25', 'Natal');
const ANO_NOVO = holiday('h1', '2026-01-01', 'Confraternização Universal');

type Handler = (url: string, init?: RequestInit) => Response;

function mockApi(handler: Handler) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const writes = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method !== 'GET') as [
    string,
    RequestInit,
  ][];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-15T12:00:00-03:00'));
});

afterEach(() => {
  cleanup();
  toast.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('tela de feriados', () => {
  it('lista os feriados do ano atual em ordem de data, sem deslocamento de fuso', async () => {
    const fetchMock = mockApi(() => json({ items: [NATAL, ANO_NOVO] }));
    render(
      <>
        <HolidaysPage />
        <ToastViewport />
      </>,
    );
    expect(screen.getByRole('status').textContent).toContain('Carregando');
    const list = await screen.findByRole('list', { name: 'Feriados de 2026' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('quinta-feira, 1 de janeiro');
    expect(items[0]!.textContent).toContain('Confraternização Universal');
    expect(items[0]!.textContent).toContain('Nacional');
    expect(items[1]!.textContent).toContain('sexta-feira, 25 de dezembro');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/holidays?year=2026');
    expect(formatHolidayDate('2026-12-25')).toBe('sexta-feira, 25 de dezembro');
  });

  it('mostra a dica de 24h, estado vazio e erro de carregamento', async () => {
    mockApi(() => json({ items: [] }));
    render(
      <>
        <HolidaysPage />
        <ToastViewport />
      </>,
    );
    expect(await screen.findByText('Nenhum feriado cadastrado em 2026.')).toBeTruthy();
    expect(screen.getByText(/plantão de 24h/)).toBeTruthy();
    cleanup();

    mockApi(() => json({ error: 'boom', message: 'Falha no servidor' }, 500));
    render(
      <>
        <HolidaysPage />
        <ToastViewport />
      </>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('Falha no servidor');
  });

  it('troca de ano refaz a consulta', async () => {
    const fetchMock = mockApi((url) =>
      json({ items: url.endsWith('2027') ? [holiday('h3', '2027-04-21', 'Tiradentes')] : [] }),
    );
    const ui = userEvent.setup();
    render(
      <>
        <HolidaysPage />
        <ToastViewport />
      </>,
    );
    await screen.findByText('Nenhum feriado cadastrado em 2026.');
    await ui.selectOptions(screen.getByLabelText('Ano'), '2027');
    expect(await screen.findByText('Tiradentes')).toBeTruthy();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/holidays?year=2026',
      '/api/holidays?year=2027',
    ]);
  });

  it('cria feriado com método, payload e cabeçalho CSRF corretos', async () => {
    const fetchMock = mockApi((url, init) =>
      init?.method === 'POST'
        ? json({ ...NATAL, name: 'Natal', warnings: [] }, 201)
        : json({ items: [] }),
    );
    const ui = userEvent.setup();
    render(
      <>
        <HolidaysPage />
        <ToastViewport />
      </>,
    );
    await screen.findByText('Nenhum feriado cadastrado em 2026.');
    await ui.click(screen.getByRole('button', { name: 'Novo feriado' }));
    const form = screen.getByRole('form', { name: 'Novo feriado' });
    fireEvent.change(within(form).getByLabelText('Data'), { target: { value: '2026-12-25' } });
    await ui.type(within(form).getByLabelText('Nome'), '  Natal ');
    await ui.selectOptions(within(form).getByLabelText('Abrangência'), 'municipal');
    await ui.click(within(form).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    const [url, init] = writes(fetchMock)[0]!;
    expect(url).toBe('/api/holidays');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      date: '2026-12-25',
      name: 'Natal',
      scope: 'municipal',
    });
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('plantao360');
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'GET')).toHaveLength(2),
    );
  });

  it('valida o formulário antes de enviar', async () => {
    const fetchMock = mockApi(() => json({ items: [] }));
    const ui = userEvent.setup();
    render(
      <>
        <HolidaysPage />
        <ToastViewport />
      </>,
    );
    await screen.findByText('Nenhum feriado cadastrado em 2026.');
    await ui.click(screen.getByRole('button', { name: 'Novo feriado' }));
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByText('Informe a data.')).toBeTruthy();
    expect(screen.getByText('Informe o nome.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'x'.repeat(101) } });
    fireEvent.change(screen.getByLabelText(/^Data/), { target: { value: '2026-12-25' } });
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByText(/no máximo 100/)).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('edita com PATCH e remove com confirmação via DELETE', async () => {
    const fetchMock = mockApi((url, init) => {
      if (init?.method === 'PATCH') return json({ ...NATAL, name: 'Natal 2026', warnings: [] });
      if (init?.method === 'DELETE') return json({ ...NATAL, warnings: [] });
      return json({ items: [NATAL] });
    });
    const ui = userEvent.setup();
    render(
      <>
        <HolidaysPage />
        <ToastViewport />
      </>,
    );
    await ui.click(await screen.findByRole('button', { name: 'Editar Natal' }));
    const form = screen.getByRole('form', { name: 'Editar feriado' });
    expect((within(form).getByLabelText('Data') as HTMLInputElement).value).toBe('2026-12-25');
    const name = within(form).getByLabelText('Nome');
    await ui.clear(name);
    await ui.type(name, 'Natal 2026');
    await ui.click(within(form).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1));
    const [url, init] = writes(fetchMock)[0]!;
    expect(url).toBe('/api/holidays/h2');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      date: '2026-12-25',
      name: 'Natal 2026',
      scope: 'national',
    });

    await ui.click(await screen.findByRole('button', { name: 'Remover Natal' }));
    expect(writes(fetchMock)).toHaveLength(1);
    await ui.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(writes(fetchMock)).toHaveLength(1);
    await ui.click(screen.getByRole('button', { name: 'Remover Natal' }));
    await ui.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(2));
    const [delUrl, delInit] = writes(fetchMock)[1]!;
    expect(delUrl).toBe('/api/holidays/h2');
    expect(delInit.method).toBe('DELETE');
  });

  it('mostra mensagem clara no 409 de duplicidade e mantém o formulário', async () => {
    mockApi((url, init) =>
      init?.method === 'POST' ? json({ error: 'duplicate_holiday' }, 409) : json({ items: [] }),
    );
    const ui = userEvent.setup();
    render(
      <>
        <HolidaysPage />
        <ToastViewport />
      </>,
    );
    await screen.findByText('Nenhum feriado cadastrado em 2026.');
    await ui.click(screen.getByRole('button', { name: 'Novo feriado' }));
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-12-25' } });
    await ui.type(screen.getByLabelText('Nome'), 'Natal');
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Já existe um feriado nesta data e abrangência.',
    );
    expect(screen.getByRole('form', { name: 'Novo feriado' })).toBeTruthy();
  });

  it('exibe os avisos de plantões publicados afetados sem bloquear', async () => {
    mockApi((url, init) =>
      init?.method === 'POST'
        ? json(
            {
              ...NATAL,
              warnings: [
                { type: 'published_shifts_affected', date: '2026-12-25', count: 1 },
                { type: 'published_shifts_affected', date: '2026-12-26', count: 3 },
              ],
            },
            201,
          )
        : json({ items: [NATAL] }),
    );
    const ui = userEvent.setup();
    render(
      <>
        <HolidaysPage />
        <ToastViewport />
      </>,
    );
    await screen.findByText('Natal');
    await ui.click(screen.getByRole('button', { name: 'Novo feriado' }));
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-12-25' } });
    await ui.type(screen.getByLabelText('Nome'), 'Natal');
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));
    const warning = await screen.findByLabelText('Aviso de impacto');
    expect(warning.textContent).toContain(`25 de dezembro: ${warningMessage(1)}`);
    expect(warning.textContent).toContain('3 plantões publicados nesta data terão as horas');
    expect(warning.textContent).toContain('Recalcular horas');
    expect(screen.getByText('Natal')).toBeTruthy();
    await ui.click(within(warning).getByRole('button', { name: 'Dispensar' }));
    expect(screen.queryByLabelText('Aviso de impacto')).toBeNull();
  });

  describe('recálculo de horas', () => {
    async function openWarning(recalc: (init?: RequestInit) => Response) {
      const fetchMock = mockApi((url, init) => {
        if (url === '/api/holidays/recalculate') return recalc(init);
        if (init?.method === 'POST')
          return json(
            {
              ...NATAL,
              warnings: [
                { type: 'published_shifts_affected', date: '2026-12-25', count: 1 },
                { type: 'published_shifts_affected', date: '2026-12-26', count: 3 },
              ],
            },
            201,
          );
        return json({ items: [NATAL] });
      });
      const ui = userEvent.setup();
      render(
        <>
          <HolidaysPage />
          <ToastViewport />
        </>,
      );
      await screen.findByText('Natal');
      await ui.click(screen.getByRole('button', { name: 'Novo feriado' }));
      fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-12-25' } });
      await ui.type(screen.getByLabelText('Nome'), 'Natal');
      await ui.click(screen.getByRole('button', { name: 'Salvar' }));
      await screen.findByLabelText('Aviso de impacto');
      return { fetchMock, ui };
    }

    it('confirma, envia as datas afetadas, informa o total e limpa o aviso', async () => {
      const { fetchMock, ui } = await openWarning(() => json({ updated: 4, changes: [] }));
      await ui.click(screen.getByRole('button', { name: 'Recalcular horas' }));
      expect(writes(fetchMock).filter((w) => w[0].endsWith('/recalculate'))).toHaveLength(0);
      await ui.click(screen.getByRole('button', { name: 'Confirmar recálculo' }));
      expect(await screen.findByText('4 plantões recalculados.')).toBeTruthy();
      const call = writes(fetchMock).find((w) => w[0] === '/api/holidays/recalculate')!;
      expect(call[1].method).toBe('POST');
      expect(JSON.parse(String(call[1].body))).toEqual({ dates: ['2026-12-25', '2026-12-26'] });
      expect(screen.queryByLabelText('Aviso de impacto')).toBeNull();
    });

    it('cancelar não chama a API e mantém o aviso', async () => {
      const { fetchMock, ui } = await openWarning(() => json({ updated: 1, changes: [] }));
      await ui.click(screen.getByRole('button', { name: 'Recalcular horas' }));
      await ui.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(writes(fetchMock).some((w) => w[0].endsWith('/recalculate'))).toBe(false);
      expect(screen.getByLabelText('Aviso de impacto')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Recalcular horas' })).toBeTruthy();
    });

    it('informa quando nenhum plantão mudou', async () => {
      const { ui } = await openWarning(() => json({ updated: 0, changes: [] }));
      await ui.click(screen.getByRole('button', { name: 'Recalcular horas' }));
      await ui.click(screen.getByRole('button', { name: 'Confirmar recálculo' }));
      expect(await screen.findByText('Nenhum plantão mudou.')).toBeTruthy();
    });

    it('mostra o erro da API e mantém o aviso para nova tentativa', async () => {
      const { ui } = await openWarning(() =>
        json({ error: 'boom', message: 'Falha ao recalcular' }, 500),
      );
      await ui.click(screen.getByRole('button', { name: 'Recalcular horas' }));
      await ui.click(screen.getByRole('button', { name: 'Confirmar recálculo' }));
      expect((await screen.findAllByRole('alert')).map((a) => a.textContent)).toEqual([
        'Falha ao recalcular',
      ]);
      expect(screen.getByLabelText('Aviso de impacto')).toBeTruthy();
      expect(
        (screen.getByRole('button', { name: 'Confirmar recálculo' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it('desabilita os botões durante a chamada', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const { ui } = await openWarning(() => json({ updated: 1, changes: [] }));
      const original = globalThis.fetch;
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
        url === '/api/holidays/recalculate'
          ? gate.then(() => json({ updated: 1, changes: [] }))
          : original(url, init),
      );
      await ui.click(screen.getByRole('button', { name: 'Recalcular horas' }));
      await ui.click(screen.getByRole('button', { name: 'Confirmar recálculo' }));
      const busy = screen.getByRole('button', { name: 'Recalculando…' }) as HTMLButtonElement;
      expect(busy.disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      release();
      expect(await screen.findByText('1 plantão recalculado.')).toBeTruthy();
    });
  });
});
