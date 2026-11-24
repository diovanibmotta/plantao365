import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, setActiveTeamId } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export interface Team {
  id: string;
  name: string;
}

export interface TeamState {
  teams: Team[];
  /** Equipe ativa; nula enquanto carrega ou quando o usuário não tem equipe. */
  activeTeam: Team | null;
  loading: boolean;
  select: (id: string) => void;
  create: (name: string) => Promise<void>;
}

const STORAGE_KEY = 'p360_team';

const readStored = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStored = (id: string) => {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // preferência opcional
  }
};

const TeamContext = createContext<TeamState | null>(null);

export function TeamProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((list: Team[], preferred: string | null) => {
    const chosen = list.find((t) => t.id === preferred) ?? list[0] ?? null;
    setActiveTeamId(chosen?.id ?? null);
    setTeams(list);
    setActiveId(chosen?.id ?? null);
  }, []);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    api
      .get<unknown>('/api/teams', controller.signal)
      .then((list) => apply(Array.isArray(list) ? (list as Team[]) : [], readStored()))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) console.error(err);
        apply([], null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, apply]);

  const select = useCallback(
    (id: string) => {
      if (!teams.some((t) => t.id === id)) return;
      writeStored(id);
      setActiveTeamId(id);
      setActiveId(id);
    },
    [teams],
  );

  const create = useCallback(
    async (name: string) => {
      const team = await api.post<Team>('/api/teams', { name });
      writeStored(team.id);
      apply(
        [...teams, team].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        team.id,
      );
    },
    [teams, apply],
  );

  const value = useMemo<TeamState>(
    () => ({
      teams,
      activeTeam: teams.find((t) => t.id === activeId) ?? null,
      loading,
      select,
      create,
    }),
    [teams, activeId, loading, select, create],
  );
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam(): TeamState {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error('useTeam deve ser usado dentro de TeamProvider');
  return ctx;
}
