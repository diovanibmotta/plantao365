import { formatDate, formatDateRange, formatHours } from './format.js';
import { renderEmail, type EmailContent, type RenderedEmail } from './templates.js';

export interface ScheduleGeneratedEmailInput {
  startDate: string;
  endDate: string;
  actorName: string;
  teamName: string;
  shifts: number;
  unassignedDates: number;
  appUrl?: string | undefined;
}

/** Aviso aos demais gestores: nova escala em rascunho, ainda não visível aos membros. */
export function renderScheduleGeneratedEmail(input: ScheduleGeneratedEmailInput): RenderedEmail {
  const period = formatDateRange(input.startDate, input.endDate);
  const lines = [`Equipe: ${input.teamName}`, `Plantões gerados: ${input.shifts}`];
  if (input.unassignedDates > 0) lines.push(`Dias sem responsável: ${input.unassignedDates}`);
  return renderEmail({
    subject: `Escala em rascunho: ${period}`,
    badge: { label: 'Rascunho', tone: 'info' },
    paragraphs: [
      `${input.actorName} gerou a escala de ${period}. Ela está em rascunho e só ficará visível aos membros após a publicação.`,
      ...(input.unassignedDates > 0
        ? ['Há dias sem responsável: revise a escala antes de publicá-la.']
        : []),
    ],
    lines,
    ...(input.appUrl ? { action: { label: 'Revisar a escala', url: input.appUrl } } : {}),
  });
}

export interface BalanceAdjustedEmailInput {
  /** Data local AAAA-MM-DD do ajuste. */
  date: string;
  /** Horas do ajuste; positivas creditam, negativas debitam. */
  hours: number;
  reason: string;
  appUrl?: string | undefined;
}

/** Aviso ao membro: o gestor lançou um ajuste manual no saldo de horas. */
export function renderBalanceAdjustedEmail(input: BalanceAdjustedEmailInput): RenderedEmail {
  const credit = input.hours >= 0;
  const amount = formatHours(Math.abs(input.hours));
  return renderEmail({
    subject: `Ajuste no seu saldo de horas: ${credit ? '+' : '-'}${amount}`,
    badge: { label: credit ? 'Crédito' : 'Débito', tone: credit ? 'success' : 'warning' },
    paragraphs: [
      credit
        ? `O gestor registrou um crédito de ${amount} no seu saldo de horas.`
        : `O gestor registrou um débito de ${amount} no seu saldo de horas.`,
      `Motivo: ${input.reason}`,
    ],
    lines: [`Data de referência: ${formatDate(input.date)}`],
    ...(input.appUrl ? { action: { label: 'Ver meu saldo', url: input.appUrl } } : {}),
  });
}

export type TeamMemberEmailKind = 'added' | 'updated' | 'removed';

export interface TeamMemberEmailInput {
  kind: TeamMemberEmailKind;
  teamName: string;
  role: 'manager' | 'member';
  participatesInRotation: boolean;
  appUrl?: string | undefined;
}

/** Aviso ao usuário: vínculo, mudança de perfil ou desligamento de uma equipe. */
export function renderTeamMemberEmail(input: TeamMemberEmailInput): RenderedEmail {
  const roleText = input.role === 'manager' ? 'gestor' : 'membro';
  const lines = [`Equipe: ${input.teamName}`];
  if (input.kind !== 'removed') {
    lines.push(
      `Perfil: ${roleText}`,
      input.participatesInRotation
        ? 'Você participa do rodízio de plantões.'
        : 'Você não participa do rodízio de plantões.',
    );
  }
  const copy: { subject: string; badge: EmailContent['badge']; text: string } = {
    added: {
      subject: `Você foi adicionado à equipe ${input.teamName}`,
      badge: { label: 'Nova equipe', tone: 'info' as const },
      text: `Você foi adicionado à equipe ${input.teamName}.`,
    },
    updated: {
      subject: `Seu perfil na equipe ${input.teamName} foi atualizado`,
      badge: { label: 'Perfil atualizado', tone: 'info' as const },
      text: `Seu perfil na equipe ${input.teamName} foi atualizado.`,
    },
    removed: {
      subject: `Você foi removido da equipe ${input.teamName}`,
      badge: { label: 'Equipe removida', tone: 'warning' as const },
      text: `Você foi removido da equipe ${input.teamName} e não receberá mais plantões dela.`,
    },
  }[input.kind];
  return renderEmail({
    subject: copy.subject,
    badge: copy.badge,
    paragraphs: [copy.text],
    lines,
    ...(input.appUrl && input.kind !== 'removed'
      ? { action: { label: 'Abrir o Plantão365', url: input.appUrl } }
      : {}),
  });
}

export interface UserStatusEmailInput {
  name: string;
  active: boolean;
  appUrl?: string | undefined;
}

/** Aviso ao usuário: acesso desativado ou reativado pelo gestor. */
export function renderUserStatusEmail(input: UserStatusEmailInput): RenderedEmail {
  if (input.active) {
    return renderEmail({
      subject: 'Seu acesso ao Plantão365 foi reativado',
      badge: { label: 'Acesso reativado', tone: 'success' },
      paragraphs: [
        `Olá, ${input.name}. Seu acesso ao Plantão365 foi reativado.`,
        'Entre com sua conta corporativa para consultar a escala.',
      ],
      ...(input.appUrl ? { action: { label: 'Entrar no Plantão365', url: input.appUrl } } : {}),
    });
  }
  return renderEmail({
    subject: 'Seu acesso ao Plantão365 foi desativado',
    badge: { label: 'Acesso desativado', tone: 'danger' },
    paragraphs: [
      `Olá, ${input.name}. Seu acesso ao Plantão365 foi desativado e você não receberá novas notificações.`,
      'Em caso de dúvida, procure o gestor da sua equipe.',
    ],
  });
}
