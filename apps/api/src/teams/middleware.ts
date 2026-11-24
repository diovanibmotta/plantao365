import { createMiddleware } from 'hono/factory';
import type { AuthEnv } from '../auth/types.js';
import type { Sql } from '../db.js';
import { listAccessibleTeams } from './service.js';

export const TEAM_HEADER = 'X-Team-Id';

/**
 * Resolve a equipe ativa da requisição em `c.var.teamId`. O front envia `X-Team-Id`; sem o
 * header usa a primeira equipe acessível (ordem alfabética). Equipe fora do acesso do usuário
 * responde 403. Também aplica ao `user` o papel e o rodízio dele na equipe ativa. Montar depois do
 * sessionMiddleware.
 */
export function teamMiddleware({ db }: { db: Sql }) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) {
      c.set('teamId', null);
      return next();
    }
    const teams = await listAccessibleTeams(db, user);
    const requested = c.req.header(TEAM_HEADER);
    if (requested) {
      if (!teams.some((t) => t.id === requested)) {
        return c.json({ error: 'team_forbidden', message: 'Sem acesso a esta equipe' }, 403);
      }
      c.set('teamId', requested);
    } else {
      c.set('teamId', teams[0]?.id ?? null);
    }
    // Papel e rodízio valem por equipe: a partir daqui `user` reflete a equipe ativa.
    const current = teams.find((t) => t.id === c.get('teamId'));
    if (current) {
      c.set('user', {
        ...user,
        role: current.role,
        participatesInRotation: current.participatesInRotation,
      });
    }
    await next();
  });
}

/** Exige equipe ativa; usuário sem nenhuma equipe recebe 409 `no_team`. */
export const requireTeam = () =>
  createMiddleware<AuthEnv>(async (c, next) => {
    if (!c.get('teamId')) {
      return c.json({ error: 'no_team', message: 'Você não pertence a nenhuma equipe' }, 409);
    }
    await next();
  });
