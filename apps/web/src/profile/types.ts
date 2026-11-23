export type ProfileRole = 'manager' | 'member';

export interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: ProfileRole;
  active: boolean;
  participatesInRotation: boolean;
  remindersEnabled: boolean;
}

export const ROLE_LABELS: Record<ProfileRole, string> = {
  manager: 'Gestor',
  member: 'Membro',
};

const PHONE_PATTERN = /^\+?[\d\s()-]+$/;

export function validatePhone(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  if (value.length > 30) return 'Telefone muito longo.';
  const digits = value.replace(/\D/g, '').length;
  if (!PHONE_PATTERN.test(value) || digits < 8 || digits > 15) {
    return 'Telefone inválido. Use de 8 a 15 dígitos, com DDD.';
  }
  return null;
}

export function phoneToPayload(raw: string): string | null {
  const value = raw.trim();
  return value === '' ? null : value;
}
