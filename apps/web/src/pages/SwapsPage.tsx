import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { SwapCard } from '../swaps/SwapCard';
import { OPEN_STATUSES } from '../swaps/types';
import type { SwapAction, SwapDto } from '../swaps/types';
import '../schedule/schedule.css';
import '../swaps/swaps.css';

type Tab = 'received' | 'sent' | 'approval' | 'history';

const TAB_LABEL: Record<Tab, string> = {
  received: 'Recebidas',
  sent: 'Enviadas',
  approval: 'Aprovação',
  history: 'Histórico',
};

const EMPTY: Record<Tab, string> = {
  received: 'Nenhuma solicitação recebida.',
  sent: 'Você não enviou solicitações.',
  approval: 'Nenhuma solicitação aguardando aprovação.',
  history: 'Nenhuma solicitação encerrada.',
};

export function SwapsPage() {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';
  const tabs: Tab[] = isManager
    ? ['received', 'sent', 'approval', 'history']
    : ['received', 'sent'];
  const [tab, setTab] = useState<Tab>('received');
  const [items, setItems] = useState<SwapDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    api
      .get<{ items: SwapDto[] }>('/api/swaps', signal)
      .then((res) => {
        setItems(res.items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : 'Não foi possível carregar as trocas.');
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const act = async (swap: SwapDto, action: SwapAction, reason: string) => {
    setActionError(null);
    try {
      await api.post(`/api/swaps/${swap.id}/${action}`, reason.trim() ? { reason } : {});
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
    }
  };

  const me = user?.id;
  const visible = (items ?? []).filter((s) => {
    if (tab === 'received') return s.counterpartId === me;
    if (tab === 'sent') return s.requesterId === me;
    if (tab === 'approval') return s.status === 'awaiting_approval';
    return !OPEN_STATUSES.includes(s.status);
  });

  const actionsFor = (s: SwapDto): SwapAction[] => {
    if (tab === 'received' && s.status === 'pending') return ['accept', 'decline'];
    if (tab === 'sent' && OPEN_STATUSES.includes(s.status)) return ['cancel'];
    if (tab === 'approval' && s.status === 'awaiting_approval') return ['approve', 'reject'];
    return [];
  };

  return (
    <section>
      <h1>Trocas</h1>
      <div className="sched-tabs" role="tablist" aria-label="Trocas">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className="sched-tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {actionError && (
        <p className="alert" role="alert">
          {actionError}
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {!error && items === null && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {items !== null &&
        (visible.length === 0 ? (
          <p className="status muted">{EMPTY[tab]}</p>
        ) : (
          <ul className="swp-list" role="tabpanel">
            {visible.map((s) => (
              <SwapCard key={s.id} swap={s} actions={actionsFor(s)} onAct={act} />
            ))}
          </ul>
        ))}
    </section>
  );
}
