// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SHIFT_TIMES } from '@diovanibmotta/plantao365-shared';
import { ScheduleAdminPage } from '../pages/ScheduleAdminPage';
import type { ShiftDto } from '../schedule/types';

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

type Handler = (url: string, init: RequestInit) => Response | undefined;

function mockApi(status: 'draft' | 'published', handler: Handler = () => undefined) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    const custom = handler(url, init);
    if (custom) return Promise.resolve(custom);
    const method = init.method ?? 'GET';
    if (url === '/api/users') return Promise.resolve(json(users));
    if (url === '/api/shift-settings' && method === 'GET') {
      return Promise.resolve(json(DEFAULT_SHIFT_TIMES));
    }
    if (url === '/api/work-hours' && method === 'GET') {
      return Promise.resolve(
        json({
          periods: [
            { startMinute: 480, endMinute: 720 },
            { startMinute: 810, endMinute: 1080 },
          ],
        }),
      );
    }
    if (url === '/api/work-hours' && method === 'PUT') {
      return Promise.resolve(new Response(init.body as string, { status: 200 }));
    }
    if (url === '/api/shift-settings' && method === 'PUT') {
      return Promise.resolve(new Response(init.body as string, { status: 200 }));
    }
    if (url === '/api/schedules' && method === 'GET')
      return Promise.resolve(json([schedule(status)]));
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

async function openSchedule() {
  const user = userEvent.setup();
  render(<ScheduleAdminPage />);
  await user.click(
    await screen.findByRole('button', { name: /Alterar escala de 02\/03\/2026 a 03\/03\/2026/ }),
  );
  await screen.findByRole('list', { name: 'Escala de março de 2026' });
  return user;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ScheduleAdminPage', () => {
  it('configura horário do plantão por tipo de dia', async () => {
    const fetchMock = mockApi('draft');
    const user = userEvent.setup();
    render(<ScheduleAdminPage />);
    await user.click(screen.getByRole('tab', { name: 'Horários dos plantões' }));
    const start = await screen.findByLabelText('Início — Dia útil');
    expect((start as HTMLSelectElement).value).toBe('18');
    expect(screen.getByRole('row', { name: /Dia útil/ }).textContent).toContain('14h');
    await user.selectOptions(screen.getByLabelText('Fim — Fim de semana'), '20');
    expect(screen.getByRole('row', { name: /Fim de semana/ }).textContent).toContain('12h');
    await user.click(screen.getByRole('button', { name: 'Salvar horários' }));
    await screen.findByText(/Horários salvos/);
    expect(bodyOf(fetchMock, '/api/shift-settings', 'PUT')).toEqual({
      ...DEFAULT_SHIFT_TIMES,
      weekend: { startHour: 8, endHour: 20 },
    });
  });

  it('edita e salva a jornada de trabalho do time', async () => {
    const fetchMock = mockApi('draft');
    const user = userEvent.setup();
    render(<ScheduleAdminPage />);
    await user.click(screen.getByRole('tab', { name: 'Jornada de trabalho' }));
    const end = await screen.findByLabelText('Fim do período 2');
    fireEvent.change(end, { target: { value: '17:30' } });
    await user.click(screen.getByRole('button', { name: 'Adicionar período' }));
    await user.click(screen.getByRole('button', { name: 'Remover período 3' }));
    await user.click(screen.getByRole('button', { name: 'Salvar jornada' }));
    await screen.findByText('Jornada salva.');
    expect(bodyOf(fetchMock, '/api/work-hours', 'PUT')).toEqual({
      periods: [
        { startMinute: 480, endMinute: 720 },
        { startMinute: 810, endMinute: 1050 },
      ],
    });
  });

  it('pesquisa escalas por situação e data', async () => {
    mockApi('draft');
    const user = userEvent.setup();
    render(<ScheduleAdminPage />);
    const row = /Alterar escala de 02\/03\/2026/;
    await screen.findByRole('button', { name: row });
    await user.selectOptions(screen.getByLabelText('Situação'), 'published');
    expect(screen.queryByRole('button', { name: row })).toBeNull();
    expect(screen.getByText('Nenhuma escala encontrada.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Situação'), 'draft');
    await user.type(screen.getByLabelText('Contém a data'), '2026-03-03');
    expect(screen.getByRole('button', { name: row })).toBeTruthy();
    await user.clear(screen.getByLabelText('Contém a data'));
    await user.type(screen.getByLabelText('Contém a data'), '2026-03-04');
    expect(screen.queryByRole('button', { name: row })).toBeNull();
  });

  it('exclui rascunho pela lista após confirmação', async () => {
    let deleted = false;
    mockApi('draft', (url, init) => {
      if (url === '/api/schedules/s1' && init.method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      if (url === '/api/schedules' && deleted) return json([]);
      return undefined;
    });
    const user = userEvent.setup();
    render(<ScheduleAdminPage />);
    await user.click(await screen.findByRole('button', { name: /Excluir escala de 02\/03\/2026/ }));
    await user.click(screen.getByRole('button', { name: 'Confirmar exclusão' }));
    await screen.findByText('Nenhuma escala criada.');
    expect(deleted).toBe(true);
  });

  it('não oferece exclusão de escala publicada', async () => {
    mockApi('published');
    render(<ScheduleAdminPage />);
    await screen.findByRole('button', { name: /Alterar escala de 02\/03\/2026/ });
    expect(screen.queryByRole('button', { name: /Excluir escala/ })).toBeNull();
  });

  it('gera rascunho e mostra dias sem responsável, violações e resumo', async () => {
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
    render(<ScheduleAdminPage />);
    await user.click(screen.getByRole('button', { name: 'Gerar escala' }));
    await user.type(screen.getByLabelText('De'), '2026-03-02');
    await user.type(screen.getByLabelText('Até'), '2026-03-03');
    await user.click(screen.getByRole('button', { name: 'Gerar rascunho' }));
    const report = await screen.findByRole('status', { name: 'Resultado da geração' });
    expect(report.textContent).toContain('Dias sem responsável: 03/03/2026');
    expect(report.textContent).toContain(
      '02/03/2026: Ana Souza (dia da semana que prefere evitar)',
    );
    expect(screen.getByRole('table', { name: 'Resumo por membro' })).toBeTruthy();
    expect(bodyOf(fetchMock, '/api/schedules/generate', 'POST')).toEqual({
      from: '2026-03-02',
      to: '2026-03-03',
    });
    await screen.findByRole('heading', { name: /Rascunho: 02\/03\/2026/ });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fecha o diálogo de gerar escala ao cancelar', async () => {
    mockApi('draft');
    const user = userEvent.setup();
    render(<ScheduleAdminPage />);
    await user.click(screen.getByRole('button', { name: 'Gerar escala' }));
    expect(screen.getByRole('dialog', { name: 'Gerar escala' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
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
    const user = await openSchedule();
    await user.click(screen.getByRole('button', { name: /03 mar 2026: sem responsável/ }));
    await user.selectOptions(screen.getByLabelText('Responsável'), 'u2');
    await user.click(screen.getByRole('button', { name: 'Salvar plantão' }));
    expect((await screen.findByRole('list', { name: 'Avisos de conflito' })).textContent).toContain(
      'Usuário tem exceção nesta data',
    );
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
    const user = await openSchedule();
    await user.click(screen.getByRole('button', { name: 'Publicar escala' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirmar publicação' });
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
    const user = await openSchedule();
    await user.click(screen.getByRole('button', { name: 'Publicar escala' }));
    expect((await screen.findByRole('alert')).textContent).toContain('já publicada');
  });

  it('descarta o rascunho após confirmação', async () => {
    const fetchMock = mockApi('draft', (url, init) =>
      url === '/api/schedules/s1' && init.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : undefined,
    );
    const user = await openSchedule();
    await user.click(screen.getByRole('button', { name: 'Descartar rascunho' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar descarte' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Rascunho/ })).toBeNull());
    expect(
      fetchMock.mock.calls.some(
        (c) =>
          c[0] === '/api/schedules/s1' && (c[1] as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(true);
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
    const user = await openSchedule();
    expect(screen.getByText(/o membro será notificado/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publicar escala' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /02 mar 2026: Ana Souza/ }));
    await user.selectOptions(screen.getByLabelText('Responsável'), 'u2');
    await user.click(screen.getByRole('button', { name: 'Salvar plantão' }));
    expect((await screen.findByRole('alert')).textContent).toContain('motivo');
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
