import { ApiError } from '../api/client';

export type MemberRole = 'manager' | 'member';

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

export const ROLE_OPTIONS: { value: MemberRole; label: string }[] = [
  { value: 'member', label: 'Membro' },
  { value: 'manager', label: 'Gestor' },
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

const ERROR_MESSAGES: Record<string, string> = {
  email_in_use: 'Já existe um usuário com este e-mail.',
  last_manager: 'Não é possível remover ou desativar o último gestor ativo.',
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

export function sortMembers(list: Member[]): Member[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
