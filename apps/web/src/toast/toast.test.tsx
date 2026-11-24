// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastViewport } from './ToastViewport';
import { TOAST_DURATION, getToasts, toast } from './toast-store';

afterEach(() => {
  cleanup();
  toast.clear();
  vi.useRealTimers();
});

describe('toast', () => {
  it('exibe sucesso como status e erro/alerta como alert', () => {
    render(<ToastViewport />);
    act(() => {
      toast.success('Salvo.');
      toast.warning('Atenção.');
      toast.error('Falhou.');
    });
    expect(screen.getByRole('status').textContent).toBe('Salvo.');
    expect(screen.getAllByRole('alert').map((e) => e.textContent)).toEqual(['Atenção.', 'Falhou.']);
  });

  it('não duplica mensagem idêntica e limita a 4 toasts', () => {
    act(() => {
      toast.error('Igual');
      toast.error('Igual');
    });
    expect(getToasts()).toHaveLength(1);
    act(() => {
      for (let i = 0; i < 6; i++) toast.success(`m${i}`);
    });
    expect(getToasts()).toHaveLength(4);
  });

  it('fecha pelo botão', async () => {
    render(<ToastViewport />);
    act(() => void toast.success('Salvo.'));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar notificação' }));
    expect(screen.queryByText('Salvo.')).toBeNull();
  });

  it('some sozinho após a duração', () => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    act(() => void toast.success('Salvo.'));
    expect(screen.getByText('Salvo.')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(TOAST_DURATION.success + 10));
    expect(screen.queryByText('Salvo.')).toBeNull();
  });
});
