import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, setActiveTeamId } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export interface Team {
  id: string;
  name: string;
  dashboardUrl?: string | null;
  avatar?: string | null;
}

export interface TeamInput {
  name: string;
  dashboardUrl: string | null;
  avatar: string | null;
}

export interface TeamState {
  teams: Team[];
  /** Equipe ativa; nula enquanto carrega ou quando o usuário não tem equipe. */
  activeTeam: Team | null;
  loading: boolean;
  select: (id: string) => void;
  create: (input: TeamInput) => Promise<Team>;
  update: (id: string, input: TeamInput) => Promise<Team>;
  remove: (id: string) => Promise<void>;
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
    async (input: TeamInput) => {
      const team = await api.post<Team>('/api/teams', input);
      apply(
        [...teams, team].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        activeId ?? team.id,
      );
      return team;
    },
    [teams, activeId, apply],
  );

  const update = useCallback(
    async (id: string, input: TeamInput) => {
      const team = await api.patch<Team>(`/api/teams/${id}`, input);
      apply(
        teams
          .map((t) => (t.id === id ? team : t))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        activeId,
      );
      return team;
    },
    [teams, activeId, apply],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.delete(`/api/teams/${id}`);
      apply(
        teams.filter((t) => t.id !== id),
        activeId === id ? null : activeId,
      );
    },
    [teams, activeId, apply],
  );

  const value = useMemo<TeamState>(
    () => ({
      teams,
      activeTeam: teams.find((t) => t.id === activeId) ?? null,
      loading,
      select,
      create,
      update,
      remove,
    }),
    [teams, activeId, loading, select, create, update, remove],
  );
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam(): TeamState {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error('useTeam deve ser usado dentro de TeamProvider');
  return ctx;
}
