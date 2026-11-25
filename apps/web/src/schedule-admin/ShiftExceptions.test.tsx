// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ScheduleAdminPage } from '../pages/ScheduleAdminPage';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { ShiftExceptionForm } from './ShiftExceptionForm';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const WORK = { periods: [{ startMinute: 480, endMinute: 720 }] };
const XMAS = {
  date: '2026-12-24',
  startHour: 15,
  endHour: 8,
  workPeriods: [{ startMinute: 480, endMinute: 900 }],
  note: 'Véspera de Natal',
};
const NEW_YEAR = {
  date: '2027-01-01',
  startHour: 12,
  endHour: 8,
  workPeriods: null,
  note: 'Confraternização',
};

function mockApi(list: unknown[]) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (url === '/api/work-hours') return Promise.resolve(json(WORK));
    if (url.startsWith('/api/shift-exceptions?from=')) {
      const date = new URL(url, 'http://x').searchParams.get('from');
      return Promise.resolve(json((list as { date: string }[]).filter((e) => e.date === date)));
    }
    if (url === '/api/shift-exceptions' && method === 'GET') return Promise.resolve(json(list));
    if (url.startsWith('/api/shift-exceptions/') && method === 'PUT') {
      return Promise.resolve(new Response(init.body as string, { status: 200 }));
    }
    if (url.startsWith('/api/shift-exceptions/') && method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url === '/api/schedules') return Promise.resolve(json([]));
    if (url === '/api/users') return Promise.resolve(json([]));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/schedule-admin" element={<ScheduleAdminPage />} />
        <Route path="/schedule-admin/exceptions/new" element={<ShiftExceptionForm />} />
        <Route path="/schedule-admin/exceptions/:date" element={<ShiftExceptionForm />} />
      </Routes>
      <ToastViewport />
    </MemoryRouter>,
  );
}

const call = (fetchMock: ReturnType<typeof vi.fn>, url: string, method: string) =>
  fetchMock.mock.calls.find(
    (c) => c[0] === url && ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method,
  );

afterEach(() => {
  cleanup();
  toast.clear();
  vi.unstubAllGlobals();
});

describe('exceções de horário: listagem', () => {
  it('lista os registros e filtra por texto, ano e jornada', async () => {
    mockApi([XMAS, NEW_YEAR]);
    const user = userEvent.setup();
    renderApp('/schedule-admin?tab=exceptions');
    expect(await screen.findByText('24/12/2026')).toBeTruthy();
    expect(screen.getByText('2 de 2 registros')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();

    await user.type(screen.getByRole('searchbox'), 'natal');
    expect(screen.queryByText('01/01/2027')).toBeNull();
    expect(screen.getByText('1 de 2 registros')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await user.selectOptions(screen.getByLabelText('Ano'), '2027');
    expect(screen.queryByText('24/12/2026')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await user.selectOptions(screen.getByLabelText('Jornada'), 'custom');
    expect(screen.queryByText('01/01/2027')).toBeNull();
    expect(screen.getByText('24/12/2026')).toBeTruthy();
  });

  it('mostra estado vazio com o CTA de cadastro', async () => {
    mockApi([]);
    renderApp('/schedule-admin?tab=exceptions');
    expect(await screen.findByText(/Cadastre as datas especiais/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nova exceção' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('o CTA abre o formulário e a linha abre a edição', async () => {
    mockApi([XMAS]);
    const user = userEvent.setup();
    renderApp('/schedule-admin?tab=exceptions');
    await user.click(await screen.findByRole('link', { name: 'Nova exceção' }));
    expect(await screen.findByRole('heading', { name: 'Nova exceção' })).toBeTruthy();
  });
});

describe('exceções de horário: formulário', () => {
  it('cria uma exceção, avisa por toast e volta à listagem', async () => {
    const fetchMock = mockApi([]);
    const user = userEvent.setup();
    renderApp('/schedule-admin/exceptions/new');
    const date = await screen.findByLabelText('Data');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Informe a data.')).toBeTruthy();
    expect(call(fetchMock, '/api/shift-exceptions/2026-12-31', 'PUT')).toBeUndefined();

    await user.type(date, '2026-12-31');
    await user.type(screen.getByLabelText('Observação'), 'Ano Novo');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText(/Exceção criada/);
    const put = call(fetchMock, '/api/shift-exceptions/2026-12-31', 'PUT')!;
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({
      startHour: 15,
      endHour: 8,
      workPeriods: null,
      note: 'Ano Novo',
    });
    expect(await screen.findByRole('heading', { name: 'Exceções de horário' })).toBeTruthy();
  });

  it('recusa data já cadastrada no novo registro', async () => {
    const fetchMock = mockApi([XMAS]);
    const user = userEvent.setup();
    renderApp('/schedule-admin/exceptions/new');
    await user.type(await screen.findByLabelText('Data'), '2026-12-24');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Já existe uma exceção para 24\/12\/2026/)).toBeTruthy();
    expect(call(fetchMock, '/api/shift-exceptions/2026-12-24', 'PUT')).toBeUndefined();
  });

  it('edita a exceção existente com a jornada própria', async () => {
    const fetchMock = mockApi([XMAS]);
    const user = userEvent.setup();
    renderApp('/schedule-admin/exceptions/2026-12-24');
    expect(await screen.findByRole('heading', { name: 'Editar exceção' })).toBeTruthy();
    expect((screen.getByLabelText('Data') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText('Observação') as HTMLInputElement).value).toBe(
      'Véspera de Natal',
    );
    expect(screen.getByLabelText('Fim do período 1')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Início'), '14');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText(/Exceção atualizada/);
    const put = call(fetchMock, '/api/shift-exceptions/2026-12-24', 'PUT')!;
    expect(JSON.parse(String((put[1] as RequestInit).body))).toMatchObject({
      startHour: 14,
      workPeriods: [{ startMinute: 480, endMinute: 900 }],
    });
  });

  it('exclui só depois da confirmação', async () => {
    const fetchMock = mockApi([XMAS]);
    const user = userEvent.setup();
    renderApp('/schedule-admin/exceptions/2026-12-24');
    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    expect(call(fetchMock, '/api/shift-exceptions/2026-12-24', 'DELETE')).toBeUndefined();
    const dialog = await screen.findByRole('dialog');
    await user.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Excluir')!,
    );
    await waitFor(() =>
      expect(call(fetchMock, '/api/shift-exceptions/2026-12-24', 'DELETE')).toBeDefined(),
    );
    await screen.findByText('Exceção excluída.');
  });

  it('não mostra Excluir no cadastro e avisa quando o registro não existe', async () => {
    mockApi([]);
    renderApp('/schedule-admin/exceptions/new');
    await screen.findByLabelText('Data');
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    cleanup();
    renderApp('/schedule-admin/exceptions/2030-01-01');
    expect(await screen.findByText('Exceção não encontrada.')).toBeTruthy();
  });
});
