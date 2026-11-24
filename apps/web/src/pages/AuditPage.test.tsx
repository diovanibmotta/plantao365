// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import type { AuthUser } from '../auth/AuthContext';
import type { AuditItem, AuditPageData } from '../audit/types';

const ANA_ID = '11111111-1111-4111-8111-111111111111';

const user = (role: AuthUser['role']): AuthUser => ({
  id: '1',
  email: 'a@b.c',
  name: 'Gestora',
  role,
  phone: null,
  participatesInRotation: true,
  remindersEnabled: true,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const item = (n: number, extra: Partial<AuditItem> = {}): AuditItem => ({
  id: String(n),
  occurredAt: '2026-03-10T01:30:00.000Z',
  actorId: '11111111-1111-4111-8111-111111111111',
  actorName: 'Ana Souza',
  actorEmail: 'ana@example.com',
  action: 'update',
  entityType: 'shift',
  entityId: `s${n}`,
  before: { owner: 'x' },
  after: { owner: 'y' },
  reason: 'troca aprovada',
  ...extra,
});

const page = (items: AuditItem[], total = items.length, offset = 0): AuditPageData => ({
  items,
  total,
  limit: 50,
  offset,
});

function mockApi(me: AuthUser, audit: (url: string) => Response) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      url === '/auth/me'
        ? json(me)
        : url === '/api/users'
          ? json([{ id: ANA_ID, name: 'Ana Souza' }])
          : audit(url),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const auditCalls = (fetchMock: ReturnType<typeof vi.fn>): URL[] =>
  fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith('/api/audit'))
    .map((u) => new URL(u, 'http://localhost'));

function renderAudit() {
  return render(
    <MemoryRouter initialEntries={['/audit']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('tela de auditoria', () => {
  it('lista os registros com ator, entidade, motivo e data local', async () => {
    mockApi(user('manager'), () => json(page([item(1)])));
    renderAudit();
    expect(await within(await screen.findByRole('table')).findByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText('Plantão')).toBeTruthy();
    expect(screen.getByText('troca aprovada')).toBeTruthy();
    expect(screen.getByText(/09\/03\/2026,? 22:30:00/)).toBeTruthy();
    expect(screen.getByText('1–1 de 1')).toBeTruthy();
  });

  it('mostra ator removido e sistema', async () => {
    mockApi(user('manager'), () =>
      json(
        page([
          item(1, { actorName: null, actorEmail: null }),
          item(2, { actorId: null, actorName: null, actorEmail: null }),
        ]),
      ),
    );
    renderAudit();
    expect(await screen.findByText(/Usuário removido/)).toBeTruthy();
    expect(screen.getByText('Sistema')).toBeTruthy();
  });

  it('aplica filtros enviando a query esperada e limpa', async () => {
    const fetchMock = mockApi(user('manager'), () => json(page([item(1)])));
    const ui = userEvent.setup();
    renderAudit();
    await screen.findByRole('table');

    await ui.type(screen.getByLabelText('De'), '2026-03-01');
    await ui.type(screen.getByLabelText('Até'), '2026-03-31');
    await ui.selectOptions(screen.getByLabelText('Tipo de entidade'), 'swap');
    await ui.selectOptions(
      await screen
        .findByRole('option', { name: 'Ana Souza' })
        .then(() => screen.getByLabelText('Ator')),
      ANA_ID,
    );
    await ui.click(screen.getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => expect(auditCalls(fetchMock)).toHaveLength(2));
    const q = auditCalls(fetchMock)[1]!.searchParams;
    expect(q.get('from')).toBe('2026-03-01T00:00:00.000-03:00');
    expect(q.get('to')).toBe('2026-03-31T23:59:59.999-03:00');
    expect(q.get('entityType')).toBe('swap');
    expect(q.get('actorId')).toBe(ANA_ID);
    expect(screen.getByRole('option', { name: 'Preferências' })).toBeTruthy();
    expect(q.get('offset')).toBe('0');

    await ui.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(auditCalls(fetchMock)).toHaveLength(3));
    const cleared = auditCalls(fetchMock)[2]!.searchParams;
    expect(cleared.has('from')).toBe(false);
    expect(cleared.has('entityType')).toBe(false);
    expect(cleared.has('actorId')).toBe(false);
    expect((screen.getByLabelText('De') as HTMLInputElement).value).toBe('');
  });

  it('pagina com anterior e próxima', async () => {
    const fetchMock = mockApi(user('manager'), (url) => {
      const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
      return json(page([item(offset + 1)], 120, offset));
    });
    const ui = userEvent.setup();
    renderAudit();
    await screen.findByText('1–1 de 120');
    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await ui.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByText('51–51 de 120');
    expect(auditCalls(fetchMock)[1]!.searchParams.get('offset')).toBe('50');

    await ui.click(screen.getByRole('button', { name: 'Anterior' }));
    await screen.findByText('1–1 de 120');
    expect(auditCalls(fetchMock)[2]!.searchParams.get('offset')).toBe('0');
  });

  it('mostra estado vazio', async () => {
    mockApi(user('manager'), () => json(page([])));
    renderAudit();
    expect(await screen.findByText('Nenhum registro encontrado.')).toBeTruthy();
  });

  it('mostra erro da API', async () => {
    mockApi(user('manager'), () => json({ message: 'Falha interna' }, 500));
    renderAudit();
    expect((await screen.findByRole('alert')).textContent).toBe('Falha interna');
  });

  it('expande e recolhe antes/depois', async () => {
    mockApi(user('manager'), () => json(page([item(1, { before: null })])));
    const ui = userEvent.setup();
    renderAudit();
    const toggle = await screen.findByRole('button', { name: 'Detalhes' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await ui.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const after = screen.getByRole('heading', { name: 'Depois' }).parentElement!;
    expect(within(after).getByText(/"owner": "y"/)).toBeTruthy();
    expect(screen.getByText('Sem valor.')).toBeTruthy();
    await ui.click(toggle);
    expect(screen.queryByRole('heading', { name: 'Depois' })).toBeNull();
  });

  it('bloqueia o membro sem chamar a API de auditoria', async () => {
    const fetchMock = mockApi(user('member'), () => json(page([item(1)])));
    renderAudit();
    expect(await screen.findByRole('heading', { name: 'Acesso restrito' })).toBeTruthy();
    expect(auditCalls(fetchMock)).toHaveLength(0);
  });
});
