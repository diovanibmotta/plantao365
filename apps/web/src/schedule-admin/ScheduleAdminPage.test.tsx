// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { DEFAULT_SHIFT_TIMES } from '@diovanibmotta/plantao365-shared';
import { ScheduleAdminPage } from '../pages/ScheduleAdminPage';
import type { ShiftDto } from '../schedule/types';
import { ToastViewport } from '../toast/ToastViewport';
import { toast } from '../toast/toast-store';
import { ScheduleEditorPage } from './ScheduleEditorPage';
import { ScheduleGenerateForm } from './ScheduleGenerateForm';
import { ShiftTimeForm } from './ShiftTimeForm';
import { WorkHoursForm } from './WorkHoursForm';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const users = [
  { id: 'u1', name: 'Ana Souza', active: true },
  { id: 'u2', name: 'Bruno Lima', active: true },
];

const shift = (date: string, userId: string | null): ShiftDto => ({
  id: `sh-${date}`,
  scheduleId: 's1',
  date,
  dayType: 'weekday',
  hours: 14,
  startsAt: null,
  endsAt: null,
  userId,
  userName: users.find((u) => u.id === userId)?.name ?? null,
  originalUserId: null,
  originalHours: null,
});

const schedule = (status: 'draft' | 'published') => ({
  id: 's1',
  startDate: '2026-03-02',
  endDate: '2026-03-03',
  status,
  publishedAt: null,
});

const WORK = {
  periods: [
    { startMinute: 480, endMinute: 720 },
    { startMinute: 810, endMinute: 1080 },
  ],
};

type Handler = (url: string, init: RequestInit) => Response | undefined;

function mockApi(
  status: 'draft' | 'published',
  handler: Handler = () => undefined,
  weekdayTimes: unknown[] = [],
) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    const custom = handler(url, init);
    if (custom) return Promise.resolve(custom);
    const method = init.method ?? 'GET';
    if (url === '/api/users') return Promise.resolve(json(users));
    if (url === '/api/shift-settings' && method === 'GET') {
      return Promise.resolve(json(DEFAULT_SHIFT_TIMES));
    }
    if (url === '/api/shift-weekday-times' && method === 'GET') {
      return Promise.resolve(json(weekdayTimes));
    }
    if (url === '/api/work-hours' && method === 'GET') return Promise.resolve(json(WORK));
    if (method === 'PUT' && (url === '/api/work-hours' || url === '/api/shift-settings')) {
      return Promise.resolve(new Response(init.body as string, { status: 200 }));
    }
    if (url === '/api/shift-weekday-times' && method === 'PUT') {
      return Promise.resolve(new Response(init.body as string, { status: 200 }));
    }
    if (url.startsWith('/api/shift-weekday-times?') && method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url === '/api/schedules' && method === 'GET') {
      return Promise.resolve(json([schedule(status)]));
    }
    if (url === '/api/schedules/s1' && method === 'GET') {
      return Promise.resolve(
        json({
          ...schedule(status),
          shifts: [shift('2026-03-02', 'u1'), shift('2026-03-03', null)],
        }),
      );
    }
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, url: string, method: string) => {
  const call = fetchMock.mock.calls.find(
    (c) => c[0] === url && (c[1] as RequestInit | undefined)?.method === method,
  );
  return call ? JSON.parse(String((call[1] as RequestInit).body ?? 'null')) : undefined;
};

const called = (fetchMock: ReturnType<typeof vi.fn>, url: string, method: string) =>
  fetchMock.mock.calls.some(
    (c) => c[0] === url && ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method,
  );

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/schedule-admin" element={<ScheduleAdminPage />} />
        <Route path="/schedule-admin/schedules/new" element={<ScheduleGenerateForm />} />
        <Route path="/schedule-admin/schedules/:id" element={<ScheduleEditorPage />} />
        <Route path="/schedule-admin/shift-times/new" element={<ShiftTimeForm />} />
        <Route path="/schedule-admin/shift-times/:key" element={<ShiftTimeForm />} />
        <Route path="/schedule-admin/work-hours/edit" element={<WorkHoursForm />} />
      </Routes>
      <ToastViewport />
    </MemoryRouter>,
  );
}

async function openEditor() {
  const user = userEvent.setup();
  renderApp('/schedule-admin');
  await user.click(
    await screen.findByRole('link', { name: /Abrir escala de 02\/03\/2026 a 03\/03\/2026/ }),
  );
  await screen.findByRole('table', { name: 'Plantões da escala' });
  return user;
}

afterEach(() => {
  cleanup();
  toast.clear();
  vi.unstubAllGlobals();
});

describe('horários dos plantões', () => {
  it('lista um registro por dia da semana e um para feriado, marcando os padrões', async () => {
    mockApi('draft', () => undefined, [{ weekday: 1, startHour: 16, endHour: 8 }]);
    const user = userEvent.setup();
    renderApp('/schedule-admin');
    await user.click(screen.getByRole('tab', { name: 'Horários dos plantões' }));
    const table = await screen.findByRole('table', { name: 'Horários dos plantões' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'Segunda',
      'Terça padrão',
      'Quarta padrão',
      'Quinta padrão',
      'Sexta padrão',
      'Sábado padrão',
      'Domingo padrão',
      'Feriado',
    ]);
    expect(rows[0]?.textContent).toContain('16:00');
    expect(rows[0]?.textContent).toContain('16h');
    expect(rows[1]?.textContent).toContain('18:00');
    expect(rows[1]?.textContent).toContain('14h');
    expect(rows[6]?.textContent).toContain('24h');
    expect(screen.getByRole('link', { name: 'Novo horário' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Editar horário de Sábado' })).toBeTruthy();
  });

  it('cadastra o mesmo horário para vários dias, incluindo fim de semana e feriado', async () => {
    const fetchMock = mockApi('draft');
    const user = userEvent.setup();
    renderApp('/schedule-admin/shift-times/new');
    await screen.findByRole('heading', { name: 'Novo horário' });
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Selecione ao menos um dia da semana ou feriado.')).toBeTruthy();
    await user.click(screen.getByLabelText('Segunda'));
    await user.click(screen.getByLabelText('Sábado'));
    await user.click(screen.getByLabelText('Domingo'));
    await user.click(screen.getByLabelText('Feriado'));
    await user.selectOptions(screen.getByLabelText('Início'), '16');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText(/Horário criado/);
    expect(bodyOf(fetchMock, '/api/shift-weekday-times', 'PUT')).toEqual({
      weekdays: [1, 6, 0],
      holiday: true,
      startHour: 16,
      endHour: 8,
    });
  });

  it('edita um dia a partir do horário em vigor e pode aplicá-lo a outros dias', async () => {
    const fetchMock = mockApi('draft', () => undefined, [
      { weekday: 3, startHour: 16, endHour: 8 },
    ]);
    const user = userEvent.setup();
    renderApp('/schedule-admin/shift-times/3');
    await screen.findByRole('heading', { name: 'Editar horário: quarta' });
    expect((screen.getByLabelText('Quarta') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Segunda') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Início') as HTMLSelectElement).value).toBe('16');
    await user.click(screen.getByLabelText('Quinta'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText(/Horário atualizado/);
    expect(bodyOf(fetchMock, '/api/shift-weekday-times', 'PUT')).toEqual({
      weekdays: [3, 4],
      holiday: false,
      startHour: 16,
      endHour: 8,
    });
  });

  it('usa o padrão do tipo de dia ao editar um dia sem horário cadastrado', async () => {
    mockApi('draft');
    renderApp('/schedule-admin/shift-times/6');
    await screen.findByRole('heading', { name: 'Editar horário: sábado' });
    expect((screen.getByLabelText('Início') as HTMLSelectElement).value).toBe('8');
    expect((screen.getByLabelText('Fim') as HTMLSelectElement).value).toBe('8');
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
  });

  it('edita o feriado, que não pode ser excluído', async () => {
    const fetchMock = mockApi('draft');
    const user = userEvent.setup();
    renderApp('/schedule-admin/shift-times/holiday');
    await screen.findByRole('heading', { name: 'Editar horário: feriado' });
    expect((screen.getByLabelText('Feriado') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Fim'), '20');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText(/Horário atualizado/);
    expect(bodyOf(fetchMock, '/api/shift-weekday-times', 'PUT')).toEqual({
      weekdays: [],
      holiday: true,
      startHour: 8,
      endHour: 20,
    });
  });

  it('exclui o horário de um dia só depois da confirmação', async () => {
    const fetchMock = mockApi('draft', () => undefined, [
      { weekday: 1, startHour: 16, endHour: 8 },
    ]);
    const user = userEvent.setup();
    renderApp('/schedule-admin/shift-times/1');
    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    expect(called(fetchMock, '/api/shift-weekday-times?weekdays=1', 'DELETE')).toBe(false);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    await screen.findByText(/Horário excluído/);
    expect(called(fetchMock, '/api/shift-weekday-times?weekdays=1', 'DELETE')).toBe(true);
  });

  it('avisa quando a rota tem um dia inválido', async () => {
    mockApi('draft');
    renderApp('/schedule-admin/shift-times/9');
    expect(await screen.findByText('Dia inválido.')).toBeTruthy();
  });
});

describe('jornada de trabalho', () => {
  it('lista os períodos e o total; edita e salva em rota própria', async () => {
    const fetchMock = mockApi('draft');
    const user = userEvent.setup();
    renderApp('/schedule-admin?tab=work-hours');
    const table = await screen.findByRole('table', { name: 'Jornada de trabalho' });
    expect(table.textContent).toContain('13:30');
    expect(screen.getByText(/Total: 8h30/)).toBeTruthy();
    cleanup();

    renderApp('/schedule-admin/work-hours/edit');
    const end = await screen.findByLabelText('Fim do período 2');
    fireEvent.change(end, { target: { value: '17:30' } });
    await user.click(screen.getByRole('button', { name: 'Adicionar período' }));
    await user.click(screen.getByRole('button', { name: 'Remover período 3' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Jornada salva.');
    expect(bodyOf(fetchMock, '/api/work-hours', 'PUT')).toEqual({
      periods: [
        { startMinute: 480, endMinute: 720 },
        { startMinute: 810, endMinute: 1050 },
      ],
    });
  });

  it('mostra estado vazio com CTA quando não há jornada', async () => {
    mockApi('draft', (url, init) =>
      url === '/api/work-hours' && (init.method ?? 'GET') === 'GET'
        ? json({ periods: [] })
        : undefined,
    );
    renderApp('/schedule-admin?tab=work-hours');
    expect(await screen.findByText(/Sem jornada definida/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Definir jornada' })).toBeTruthy();
  });
});

describe('escalas: listagem', () => {
  it('pesquisa por texto, situação e data', async () => {
    mockApi('draft');
    const user = userEvent.setup();
    renderApp('/schedule-admin');
    const row = /Abrir escala de 02\/03\/2026/;
    await screen.findByRole('link', { name: row });
    await user.selectOptions(screen.getByLabelText('Situação'), 'published');
    expect(screen.queryByRole('link', { name: row })).toBeNull();
    expect(screen.getByText('Nenhuma escala encontrada.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Situação'), 'draft');
    await user.type(screen.getByLabelText('Contém a data'), '2026-03-03');
    expect(screen.getByRole('link', { name: row })).toBeTruthy();
    await user.clear(screen.getByLabelText('Contém a data'));
    await user.type(screen.getByLabelText('Contém a data'), '2026-03-04');
    expect(screen.queryByRole('link', { name: row })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await user.type(screen.getByRole('searchbox'), 'rascunho');
    expect(screen.getByRole('link', { name: row })).toBeTruthy();
    expect(screen.getByText('1 de 1 registro')).toBeTruthy();
  });

  it('mostra selo de situação na lista e o CTA de gerar', async () => {
    mockApi('draft');
    renderApp('/schedule-admin');
    await screen.findByRole('link', { name: /Abrir escala de 02\/03\/2026/ });
    expect(screen.getByRole('table', { name: 'Escalas' }).textContent).toContain('Rascunho');
    expect(screen.getByRole('link', { name: 'Gerar escala' })).toBeTruthy();
  });
});

describe('escalas: gerar', () => {
  it('gera rascunho e abre o editor com dias sem responsável, violações e resumo', async () => {
    const fetchMock = mockApi('draft', (url, init) => {
      if (url === '/api/schedules/generate' && init.method === 'POST') {
        return json(
          {
            schedule: schedule('draft'),
            shifts: [shift('2026-03-02', 'u1'), shift('2026-03-03', null)],
            unassignedDates: ['2026-03-03'],
            preferenceViolations: [{ date: '2026-03-02', userId: 'u1', kind: 'avoid_weekday' }],
            summary: [{ userId: 'u1', hours: 14, weekendHolidayShifts: 0, shifts: 1 }],
          },
          201,
        );
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderApp('/schedule-admin');
    await user.click(await screen.findByRole('link', { name: 'Gerar escala' }));
    await screen.findByRole('heading', { name: 'Gerar escala' });
    await user.click(screen.getByRole('button', { name: 'Gerar rascunho' }));
    expect(await screen.findByText('Informe o início e o fim do período.')).toBeTruthy();
    await user.type(screen.getByLabelText('De'), '2026-03-02');
    await user.type(screen.getByLabelText('Até'), '2026-03-03');
    await user.click(screen.getByRole('button', { name: 'Gerar rascunho' }));
    const report = await screen.findByRole('status', { name: 'Resultado da geração' });
    expect(report.textContent).toContain('Dias sem responsável: 03/03/2026');
    expect(report.textContent).toContain(
      '02/03/2026: Ana Souza (dia da semana que prefere evitar)',
    );
    expect(screen.getByRole('table', { name: 'Resumo por membro' })).toBeTruthy();
    expect(screen.getByText('Dias cobertos').nextSibling?.textContent).toBe('1/2');
    expect(bodyOf(fetchMock, '/api/schedules/generate', 'POST')).toEqual({
      from: '2026-03-02',
      to: '2026-03-03',
    });
    await screen.findByRole('heading', { name: /Rascunho: 02\/03\/2026/ });
  });

  it('volta à listagem ao cancelar', async () => {
    mockApi('draft');
    const user = userEvent.setup();
    renderApp('/schedule-admin/schedules/new');
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('table', { name: 'Escalas' })).toBeTruthy();
  });
});

describe('escalas: editor', () => {
  it('não oferece descarte nem publicação em escala publicada', async () => {
    mockApi('published');
    await openEditor();
    expect(screen.queryByRole('button', { name: 'Descartar rascunho' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publicar escala' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeTruthy();
  });

  it('lista data, dia, responsável, horário e horas de cada plantão', async () => {
    mockApi('draft');
    await openEditor();
    const rows = within(screen.getByRole('table', { name: 'Plantões da escala' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('02/03/2026');
    expect(rows[0]?.textContent).toContain('Segunda');
    expect(rows[0]?.textContent).toContain('18:00–08:00');
    expect(rows[0]?.textContent).toContain('14h');
    expect((screen.getByLabelText('Responsável em 02/03/2026') as HTMLSelectElement).value).toBe(
      'u1',
    );
    expect((screen.getByLabelText('Responsável em 03/03/2026') as HTMLSelectElement).value).toBe(
      '',
    );
  });

  it('edita plantão do rascunho e exibe avisos de conflito', async () => {
    const fetchMock = mockApi('draft', (url, init) => {
      if (url === '/api/schedules/s1/shifts/sh-2026-03-03' && init.method === 'PATCH') {
        return json({
          shift: shift('2026-03-03', 'u2'),
          warnings: [{ code: 'user_unavailable', message: 'Usuário tem exceção nesta data' }],
        });
      }
      return undefined;
    });
    const user = await openEditor();
    await user.selectOptions(screen.getByLabelText('Responsável em 03/03/2026'), 'u2');
    expect(await screen.findByText('Usuário tem exceção nesta data')).toBeTruthy();
    expect(bodyOf(fetchMock, '/api/schedules/s1/shifts/sh-2026-03-03', 'PATCH')).toEqual({
      userId: 'u2',
    });
  });

  it('publica com confirmação quando há dias sem responsável', async () => {
    const fetchMock = mockApi('draft', (url, init) => {
      if (url === '/api/schedules/s1/publish' && init.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { confirmUnassigned?: boolean };
        return body.confirmUnassigned
          ? json({ schedule: schedule('published'), shifts: [], unassignedDates: ['2026-03-03'] })
          : json(
              { error: 'confirmation_required', message: 'x', unassignedDates: ['2026-03-03'] },
              409,
            );
      }
      return undefined;
    });
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: 'Publicar escala' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar publicação' });
    expect(dialog.textContent).toContain('03/03/2026');
    await user.click(screen.getByRole('button', { name: 'Publicar mesmo assim' }));
    await screen.findByText('Escala publicada.');
    const publishBodies = fetchMock.mock.calls
      .filter((c) => c[0] === '/api/schedules/s1/publish')
      .map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(publishBodies).toEqual([{}, { confirmUnassigned: true }]);
  });

  it('informa sobreposição com escala já publicada', async () => {
    mockApi('draft', (url, init) =>
      url === '/api/schedules/s1/publish' && init.method === 'POST'
        ? json({ error: 'schedule_overlap_published', message: 'x' }, 409)
        : undefined,
    );
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: 'Publicar escala' }));
    expect(await screen.findByText(/já publicada/)).toBeTruthy();
  });

  it('descarta o rascunho após confirmação e volta à listagem', async () => {
    const fetchMock = mockApi('draft', (url, init) =>
      url === '/api/schedules/s1' && init.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : undefined,
    );
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: 'Descartar rascunho' }));
    expect(called(fetchMock, '/api/schedules/s1', 'DELETE')).toBe(false);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Descartar' }),
    );
    await waitFor(() => expect(called(fetchMock, '/api/schedules/s1', 'DELETE')).toBe(true));
    expect(await screen.findByRole('table', { name: 'Escalas' })).toBeTruthy();
  });

  it('exige motivo em escala publicada e avisa que o membro será notificado', async () => {
    const fetchMock = mockApi('published', (url, init) =>
      url === '/api/schedules/s1/shifts/sh-2026-03-02' && init.method === 'PATCH'
        ? json({
            shift: shift('2026-03-02', 'u2'),
            warnings: [],
            notice: 'Os membros envolvidos serão notificados da alteração.',
          })
        : undefined,
    );
    const user = await openEditor();
    expect(screen.getByText(/o membro será notificado/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Responsável em 02/03/2026'), 'u2');
    await user.click(screen.getByRole('button', { name: 'Salvar plantão' }));
    expect(await screen.findByText('Informe o motivo da alteração.')).toBeTruthy();
    expect(bodyOf(fetchMock, '/api/schedules/s1/shifts/sh-2026-03-02', 'PATCH')).toBeUndefined();
    await user.type(screen.getByLabelText('Motivo (obrigatório)'), 'Troca combinada');
    await user.click(screen.getByRole('button', { name: 'Salvar plantão' }));
    await screen.findByText('Os membros envolvidos serão notificados da alteração.');
    expect(bodyOf(fetchMock, '/api/schedules/s1/shifts/sh-2026-03-02', 'PATCH')).toEqual({
      userId: 'u2',
      reason: 'Troca combinada',
    });
  });
});
