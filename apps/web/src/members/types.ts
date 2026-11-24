import { ApiError } from '../api/client';

export type MemberRole = 'manager' | 'member' | 'guest';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  active: boolean;
  participatesInRotation: boolean;
  createdAt: string;
  linked: boolean;
}

export interface NewMemberInput {
  name: string;
  email: string;
  role: MemberRole;
  participatesInRotation: boolean;
}

/** Papéis atribuíveis num convite (convidado é o papel de quem entra sem convite). */
export const ROLE_OPTIONS: { value: MemberRole; label: string }[] = [
  { value: 'member', label: 'Membro' },
  { value: 'manager', label: 'Gestor' },
];

/** Papéis editáveis na tabela: inclui rebaixar para convidado (somente leitura). */
export const TABLE_ROLE_OPTIONS: { value: MemberRole; label: string }[] = [
  ...ROLE_OPTIONS,
  { value: 'guest', label: 'Convidado' },
];

export const defaultParticipates = (role: MemberRole): boolean => role === 'member';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewMemberErrors {
  name?: string;
  email?: string;
}

export function validateNewMember(name: string, email: string): NewMemberErrors {
  const errors: NewMemberErrors = {};
  if (name.trim() === '') errors.name = 'Informe o nome.';
  if (email.trim() === '') errors.email = 'Informe o e-mail.';
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'E-mail inválido.';
  return errors;
}

export interface FutureShift {
  shiftId: string;
  date: string;
  scheduleId: string;
  scheduleStart: string;
  scheduleEnd: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  email_in_use: 'Já existe um usuário com este e-mail.',
  has_future_published_shifts:
    'Não é possível desativar: o membro tem plantões futuros publicados. Reatribua-os antes.',
  last_manager: 'Não é possível remover ou desativar o último gestor ativo.',
  member_has_shifts:
    'Não é possível desvincular: o membro possui plantões nas escalas desta equipe.',
};

export function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 409) {
    const code =
      typeof err.body === 'object' && err.body !== null && 'error' in err.body
        ? String((err.body as { error: unknown }).error)
        : '';
    return ERROR_MESSAGES[code] ?? err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

/** Plantões futuros que bloqueiam a desativação (409 has_future_published_shifts), se for o caso. */
export function blockingShifts(err: unknown): FutureShift[] {
  if (!(err instanceof ApiError) || err.status !== 409) return [];
  const body = err.body as { error?: unknown; shifts?: unknown } | null | undefined;
  if (typeof body !== 'object' || body === null) return [];
  if (body.error !== 'has_future_published_shifts' || !Array.isArray(body.shifts)) return [];
  return body.shifts as FutureShift[];
}

const formatDate = (iso: string): string => iso.split('-').reverse().join('/');

export const describeShift = (s: FutureShift): string =>
  `${formatDate(s.date)} (escala de ${formatDate(s.scheduleStart)} a ${formatDate(s.scheduleEnd)})`;

export function sortMembers(list: Member[]): Member[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
