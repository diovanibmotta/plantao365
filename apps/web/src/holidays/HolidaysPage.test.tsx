// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { HolidaysPage } from '../pages/HolidaysPage';
import { HolidayForm } from './HolidayForm';
import type { Holiday } from './types';
import { formatHolidayDate, warningMessage } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const holiday = (
  id: string,
  date: string,
  name: string,
  scope: Holiday['scope'] = 'national',
): Holiday => ({ id, date, name, scope });

const NATAL = holiday('h2', '2026-12-25', 'Natal');
const ANO_NOVO = holiday('h1', '2026-01-01', 'Confraternização Universal');
const SAO_JOAO = holiday('h4', '2026-06-24', 'São João', 'state');

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

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/holidays" element={<HolidaysPage />} />
        <Route path="/holidays/new" element={<HolidayForm />} />
        <Route path="/holidays/:id" element={<HolidayForm />} />
      </Routes>
      <ToastViewport />
    </MemoryRouter>,
  );
}

const WARNINGS = [
  { type: 'published_shifts_affected', date: '2026-12-25', count: 1 },
  { type: 'published_shifts_affected', date: '2026-12-26', count: 3 },
];

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

describe('listagem de feriados', () => {
  it('lista os feriados do ano em ordem de data, sem deslocamento de fuso', async () => {
    const fetchMock = mockApi(() => json({ items: [NATAL, ANO_NOVO] }));
    renderApp('/holidays');
    expect(screen.getByRole('status').textContent).toContain('Carregando');
    const table = await screen.findByRole('table', { name: 'Feriados de 2026' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]!.textContent).toContain('quinta-feira, 1 de janeiro');
    expect(rows[0]!.textContent).toContain('Confraternização Universal');
    expect(rows[0]!.textContent).toContain('Nacional');
    expect(rows[1]!.textContent).toContain('sexta-feira, 25 de dezembro');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/holidays?year=2026');
    expect(formatHolidayDate('2026-12-25')).toBe('sexta-feira, 25 de dezembro');
    expect(screen.getByText('2 de 2 registros')).toBeTruthy();
    expect(screen.getByText(/plantão de 24h/)).toBeTruthy();
  });

  it('busca por nome sem acento/caixa e por data, e mostra mensagem quando zera', async () => {
    mockApi(() => json({ items: [NATAL, ANO_NOVO, SAO_JOAO] }));
    const ui = userEvent.setup();
    renderApp('/holidays');
    await screen.findByRole('table');
    const search = screen.getByRole('searchbox');
    await ui.type(search, 'sao joao');
    expect(screen.getByText('São João')).toBeTruthy();
    expect(screen.queryByText('Natal')).toBeNull();
    expect(screen.getByText('1 de 3 registros')).toBeTruthy();
    await ui.clear(search);
    await ui.type(search, '25 de dezembro');
    expect(screen.getByText('Natal')).toBeTruthy();
    expect(screen.queryByText('São João')).toBeNull();
    await ui.clear(search);
    await ui.type(search, 'zzz');
    expect(screen.getByText('Nenhum registro encontrado para os filtros aplicados.')).toBeTruthy();
    await ui.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByText('3 de 3 registros')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();
  });

  it('filtra por abrangência', async () => {
    mockApi(() => json({ items: [NATAL, SAO_JOAO] }));
    const ui = userEvent.setup();
    renderApp('/holidays');
    await screen.findByRole('table');
    await ui.selectOptions(screen.getByLabelText('Abrangência'), 'state');
    expect(screen.getByText('São João')).toBeTruthy();
    expect(screen.queryByText('Natal')).toBeNull();
    expect(screen.getByText('1 de 2 registros')).toBeTruthy();
  });

  it('troca de ano refaz a consulta', async () => {
    const fetchMock = mockApi((url) =>
      json({ items: url.endsWith('2027') ? [holiday('h3', '2027-04-21', 'Tiradentes')] : [NATAL] }),
    );
    const ui = userEvent.setup();
    renderApp('/holidays');
    await screen.findByText('Natal');
    await ui.selectOptions(screen.getByLabelText('Ano'), '2027');
    expect(await screen.findByText('Tiradentes')).toBeTruthy();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/holidays?year=2026',
      '/api/holidays?year=2027',
    ]);
  });

  it('mostra o estado vazio com CTA e o erro de carregamento', async () => {
    mockApi(() => json({ items: [] }));
    renderApp('/holidays');
    expect(await screen.findByText('Nenhum feriado cadastrado em 2026.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Novo feriado' })).toHaveLength(2);
    cleanup();

    mockApi(() => json({ error: 'boom', message: 'Falha no servidor' }, 500));
    renderApp('/holidays');
    expect((await screen.findByRole('alert')).textContent).toBe('Falha no servidor');
  });

  it('Editar e Novo feriado abrem o formulário em rota própria', async () => {
    mockApi((url) => (url.startsWith('/api/holidays/h2') ? json(NATAL) : json({ items: [NATAL] })));
    const ui = userEvent.setup();
    renderApp('/holidays');
    await ui.click(await screen.findByRole('link', { name: 'Editar Natal' }));
    expect(await screen.findByRole('heading', { name: 'Editar feriado' })).toBeTruthy();
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Natal');
    await ui.click(screen.getByRole('button', { name: 'Cancelar' }));
    await ui.click(await screen.findByRole('link', { name: 'Novo feriado' }));
    expect(await screen.findByRole('heading', { name: 'Novo feriado' })).toBeTruthy();
  });
});

describe('formulário de feriado', () => {
  it('cria feriado com payload e CSRF corretos e volta à listagem', async () => {
    const fetchMock = mockApi((_url, init) =>
      init?.method === 'POST' ? json({ ...NATAL, warnings: [] }, 201) : json({ items: [] }),
    );
    const ui = userEvent.setup();
    renderApp('/holidays/new');
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-12-25' } });
    await ui.type(screen.getByLabelText('Nome'), '  Natal ');
    await ui.selectOptions(screen.getByLabelText('Abrangência'), 'municipal');
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('heading', { name: 'Feriados' })).toBeTruthy();
    const [url, init] = writes(fetchMock)[0]!;
    expect(url).toBe('/api/holidays');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      date: '2026-12-25',
      name: 'Natal',
      scope: 'municipal',
    });
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('plantao360');
    expect(await screen.findByText('Feriado criado.')).toBeTruthy();
  });

  it('valida o formulário antes de enviar', async () => {
    const fetchMock = mockApi(() => json({ items: [] }));
    const ui = userEvent.setup();
    renderApp('/holidays/new');
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByText('Informe a data.')).toBeTruthy();
    expect(screen.getByText('Informe o nome.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'x'.repeat(101) } });
    fireEvent.change(screen.getByLabelText(/^Data/), { target: { value: '2026-12-25' } });
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByText(/no máximo 100/)).toBeTruthy();
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('edita carregando o registro pela API e envia PATCH', async () => {
    const fetchMock = mockApi((url, init) => {
      if (init?.method === 'PATCH') return json({ ...NATAL, name: 'Natal 2026', warnings: [] });
      if (url === '/api/holidays/h2') return json(NATAL);
      return json({ items: [NATAL] });
    });
    const ui = userEvent.setup();
    renderApp('/holidays/h2');
    const name = await screen.findByLabelText('Nome');
    expect((screen.getByLabelText('Data') as HTMLInputElement).value).toBe('2026-12-25');
    await ui.clear(name);
    await ui.type(name, 'Natal 2026');
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('heading', { name: 'Feriados' });
    const [url, init] = writes(fetchMock)[0]!;
    expect(url).toBe('/api/holidays/h2');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      date: '2026-12-25',
      name: 'Natal 2026',
      scope: 'national',
    });
  });

  it('exclui só após confirmar e a confirmação explica o efeito', async () => {
    const fetchMock = mockApi((url, init) => {
      if (init?.method === 'DELETE') return json({ ...NATAL, warnings: [] });
      if (url === '/api/holidays/h2') return json(NATAL);
      return json({ items: [] });
    });
    const ui = userEvent.setup();
    renderApp('/holidays/h2');
    await ui.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('próximas escalas geradas');
    expect(dialog.textContent).toContain('recalcular');
    expect(writes(fetchMock)).toHaveLength(0);
    await ui.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(fetchMock)).toHaveLength(0);

    await ui.click(screen.getByRole('button', { name: 'Excluir' }));
    await ui.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    await screen.findByRole('heading', { name: 'Feriados' });
    const [url, init] = writes(fetchMock)[0]!;
    expect(url).toBe('/api/holidays/h2');
    expect(init.method).toBe('DELETE');
  });

  it('registro inexistente mostra mensagem e volta para a listagem', async () => {
    mockApi((url) =>
      url === '/api/holidays/nope' ? json({ error: 'not_found' }, 404) : json({ items: [] }),
    );
    const ui = userEvent.setup();
    renderApp('/holidays/nope');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Feriado não encontrado. Atualize a lista.',
    );
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    await ui.click(screen.getByRole('button', { name: 'Voltar para a listagem' }));
    expect(await screen.findByRole('heading', { name: 'Feriados' })).toBeTruthy();
  });

  it('mostra mensagem clara no 409 de duplicidade e mantém o formulário', async () => {
    mockApi((_url, init) =>
      init?.method === 'POST' ? json({ error: 'duplicate_holiday' }, 409) : json({ items: [] }),
    );
    const ui = userEvent.setup();
    renderApp('/holidays/new');
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-12-25' } });
    await ui.type(screen.getByLabelText('Nome'), 'Natal');
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Já existe um feriado nesta data e abrangência.',
    );
    expect(screen.getByRole('heading', { name: 'Novo feriado' })).toBeTruthy();
  });

  describe('avisos e recálculo de horas', () => {
    async function saveWithWarnings(recalc: () => Response) {
      const fetchMock = mockApi((url, init) => {
        if (url === '/api/holidays/recalculate') return recalc();
        if (init?.method === 'POST') return json({ ...NATAL, warnings: WARNINGS }, 201);
        return json({ items: [NATAL] });
      });
      const ui = userEvent.setup();
      renderApp('/holidays/new');
      fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-12-25' } });
      await ui.type(screen.getByLabelText('Nome'), 'Natal');
      await ui.click(screen.getByRole('button', { name: 'Salvar' }));
      await screen.findByLabelText('Aviso de impacto');
      return { fetchMock, ui };
    }

    it('exibe os avisos sem bloquear e permite dispensar', async () => {
      const { ui } = await saveWithWarnings(() => json({ updated: 0, changes: [] }));
      const warning = screen.getByLabelText('Aviso de impacto');
      expect(warning.textContent).toContain(`25 de dezembro: ${warningMessage(1)}`);
      expect(warning.textContent).toContain('3 plantões publicados nesta data terão as horas');
      await ui.click(within(warning).getByRole('button', { name: 'Dispensar' }));
      expect(await screen.findByRole('heading', { name: 'Feriados' })).toBeTruthy();
    });

    it('confirma, envia as datas afetadas, informa o total e volta à listagem', async () => {
      const { fetchMock, ui } = await saveWithWarnings(() => json({ updated: 4, changes: [] }));
      await ui.click(screen.getByRole('button', { name: 'Recalcular horas' }));
      expect(writes(fetchMock).some((w) => w[0].endsWith('/recalculate'))).toBe(false);
      await ui.click(screen.getByRole('button', { name: 'Confirmar recálculo' }));
      expect(await screen.findByText('4 plantões recalculados.')).toBeTruthy();
      const call = writes(fetchMock).find((w) => w[0] === '/api/holidays/recalculate')!;
      expect(JSON.parse(String(call[1].body))).toEqual({ dates: ['2026-12-25', '2026-12-26'] });
      expect(screen.getByRole('heading', { name: 'Feriados' })).toBeTruthy();
    });

    it('cancelar não chama a API e mantém o aviso', async () => {
      const { fetchMock, ui } = await saveWithWarnings(() => json({ updated: 1, changes: [] }));
      await ui.click(screen.getByRole('button', { name: 'Recalcular horas' }));
      await ui.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
      expect(writes(fetchMock).some((w) => w[0].endsWith('/recalculate'))).toBe(false);
      expect(screen.getByLabelText('Aviso de impacto')).toBeTruthy();
    });

    it('mostra o erro da API e mantém o aviso para nova tentativa', async () => {
      const { ui } = await saveWithWarnings(() =>
        json({ error: 'boom', message: 'Falha ao recalcular' }, 500),
      );
      await ui.click(screen.getByRole('button', { name: 'Recalcular horas' }));
      await ui.click(screen.getByRole('button', { name: 'Confirmar recálculo' }));
      await waitFor(() =>
        expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain(
          'Falha ao recalcular',
        ),
      );
      expect(screen.getByLabelText('Aviso de impacto')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Recalcular horas' })).toBeTruthy();
    });
  });
});
