// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ShiftDto } from '../schedule/types';
import { ScheduleCsvExport } from './ScheduleCsvExport';
import { ScheduleEditorPage } from './ScheduleEditorPage';
import { downloadSchedulePdf } from './schedule-pdf';

vi.mock('./schedule-pdf', () => ({ downloadSchedulePdf: vi.fn(() => Promise.resolve()) }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const shift = (date: string, userId: string | null, userName: string | null): ShiftDto => ({
  id: `sh-${date}`,
  scheduleId: 's1',
  date,
  dayType: 'weekday',
  hours: 14,
  startsAt: null,
  endsAt: null,
  userId,
  userName,
  originalUserId: null,
  originalHours: null,
});

const detail = {
  id: 's1',
  startDate: '2026-03-02',
  endDate: '2026-03-03',
  status: 'draft',
  publishedAt: null,
  createdBy: 'u1',
  shifts: [shift('2026-03-02', 'u1', 'Ana Souza'), shift('2026-03-03', null, null)],
};

function mockApi(scheduleStatus = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/users')
        return Promise.resolve(json([{ id: 'u1', name: 'Ana Souza', active: true }]));
      if (url === '/api/schedules/s1') {
        return Promise.resolve(
          scheduleStatus === 200 ? json(detail) : json({ error: 'not_found' }, scheduleStatus),
        );
      }
      return Promise.resolve(json({}, 404));
    }),
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/schedule-admin" element={<p>Listagem</p>} />
        <Route path="/schedule-admin/schedules/:id" element={<ScheduleEditorPage />} />
        <Route path="/schedule-admin/schedules/:id/export" element={<ScheduleCsvExport />} />
      </Routes>
    </MemoryRouter>,
  );
}

const headers = () =>
  within(screen.getByRole('table', { name: 'Prévia do CSV' }))
    .getAllByRole('columnheader')
    .map((th) => th.textContent);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('exportação da escala', () => {
  it('editor gera o PDF direto e leva à exportação CSV', async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt('/schedule-admin/schedules/s1');
    await user.click(await screen.findByRole('button', { name: 'Relatório PDF' }));
    expect(downloadSchedulePdf).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), {
      teamName: '',
      managerName: 'Ana Souza',
    });
    await user.click(screen.getByRole('link', { name: 'Exportar CSV' }));
    expect(await screen.findByRole('heading', { name: 'Exportar CSV' })).toBeTruthy();
  });

  it('escolhe e ordena campos, mostra a prévia e baixa o CSV', async () => {
    mockApi();
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:csv');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    renderAt('/schedule-admin/schedules/s1/export');

    await screen.findByRole('table', { name: 'Prévia do CSV' });
    expect(headers()).toEqual([
      'Data',
      'Dia da semana',
      'Tipo do dia',
      'Responsável',
      'Início',
      'Fim',
      'Horas',
    ]);

    await user.click(screen.getByRole('checkbox', { name: 'Dia da semana' }));
    await user.click(screen.getByRole('checkbox', { name: 'Tipo do dia' }));
    await user.click(screen.getByRole('button', { name: 'Mover Responsável para cima' }));
    await user.click(screen.getByRole('button', { name: 'Mover Responsável para cima' }));
    await user.click(screen.getByRole('button', { name: 'Mover Responsável para cima' }));
    expect(headers()).toEqual(['Responsável', 'Data', 'Início', 'Fim', 'Horas']);
    expect(screen.getByText('Sem responsável')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Baixar CSV' }));
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(click).toHaveBeenCalled();
    const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
    // BOM UTF-8 para o Excel reconhecer acentos; Blob.text() já o descarta.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect((await blob?.text())?.split(/\r\n/).slice(0, 2)).toEqual([
      'Responsável;Data;Início;Fim;Horas',
      'Ana Souza;02/03/2026;18:00;08:00;14',
    ]);
    expect(await screen.findByRole('button', { name: 'Relatório PDF' })).toBeTruthy();
    click.mockRestore();
  });

  it('sem campos marcados bloqueia o download', async () => {
    mockApi();
    const user = userEvent.setup();
    renderAt('/schedule-admin/schedules/s1/export');
    await screen.findByRole('table', { name: 'Prévia do CSV' });
    for (const box of screen.getAllByRole('checkbox', { checked: true })) await user.click(box);
    expect(screen.getByRole('alert').textContent).toBe('Selecione ao menos um campo.');
    expect(screen.getByRole('button', { name: 'Baixar CSV' })).toHaveProperty('disabled', true);
  });

  it('escala inexistente mostra erro e volta para a listagem', async () => {
    mockApi(404);
    const user = userEvent.setup();
    renderAt('/schedule-admin/schedules/s1/export');
    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Voltar para a listagem' }));
    expect(screen.getByText('Listagem')).toBeTruthy();
  });
});
