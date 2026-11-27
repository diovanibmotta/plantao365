// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination, usePagination } from './Pagination';

afterEach(cleanup);

const ITEMS = Array.from({ length: 30 }, (_, i) => i + 1);

function Demo({ filter = '' }: { filter?: string }) {
  const pager = usePagination(ITEMS, filter);
  return (
    <>
      <ul>
        {pager.slice.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <Pagination
        total={ITEMS.length}
        filtered={ITEMS.length}
        page={pager.page}
        pages={pager.pages}
        pageSize={pager.pageSize}
        onPage={pager.setPage}
        onPageSize={pager.setPageSize}
      />
    </>
  );
}

describe('paginação', () => {
  it('navega com < e >, mostra "X de Y páginas" e desabilita nas pontas', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
    expect(screen.getByText('1 de 2 páginas')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('2 de 2 páginas')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Próxima' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('volta à página 1 quando o filtro muda e ao trocar o tamanho', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    rerender(<Demo filter="x" />);
    expect(screen.getByText('1 de 2 páginas')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await user.selectOptions(screen.getByLabelText('Registros por página'), '10');
    expect(screen.getByText('1 de 3 páginas')).toBeTruthy();
  });
});
