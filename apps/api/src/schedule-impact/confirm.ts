import type { Context } from 'hono';
import { impactConfirmMessage } from './message.js';
import type { ScheduleImpact } from './types.js';

/** Query string que o web envia depois de o usuário confirmar o aviso de impacto. */
export const IMPACT_CONFIRM_PARAM = 'confirmImpact';

export const IMPACT_CONFIRMATION_ERROR = 'schedule_impact_confirmation_required';

/**
 * Lançado dentro da transação da mutação quando ela atinge escala publicada e o usuário ainda não
 * confirmou: a transação é desfeita (nada é salvo nem enviado) e a resposta é 409 com o impacto.
 */
export class ScheduleImpactConfirmationRequired extends Error {
  constructor(readonly impact: ScheduleImpact) {
    super(IMPACT_CONFIRMATION_ERROR);
    this.name = 'ScheduleImpactConfirmationRequired';
  }
}

export const isImpactConfirmed = (c: Context): boolean =>
  c.req.query(IMPACT_CONFIRM_PARAM) === 'true';

/** Resposta 409 do erro de confirmação; `undefined` para qualquer outro erro. */
export function impactConfirmationResponse(err: unknown, c: Context): Response | undefined {
  if (!(err instanceof ScheduleImpactConfirmationRequired)) return undefined;
  const { impact } = err;
  return c.json(
    {
      error: IMPACT_CONFIRMATION_ERROR,
      message: impactConfirmMessage(impact.source, impact.shifts, impact.removed),
      scheduleImpact: impact,
    },
    409,
  );
}
