export type ProfileRole = 'manager' | 'member';

export interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  badgeNumber: string | null;
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

function formatNationalPhone(digits: string): string {
  if (digits === '') return '';
  const ddd = digits.slice(0, 2);
  if (digits.length <= 2) return `(${ddd}`;
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const split = digits.length <= 10 ? 4 : 5;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** Máscara de telefone brasileiro: (DD) 9XXXX-XXXX, com prefixo +55 opcional. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) {
    if (digits.startsWith('55')) {
      const national = formatNationalPhone(digits.slice(2, 13));
      return national === '' ? '+55' : `+55 ${national}`;
    }
    return `+${digits.slice(0, 15)}`;
  }
  return formatNationalPhone(digits.slice(0, 11));
}

export function validateBadge(raw: string): string | null {
  return raw.trim().length > 30 ? 'Crachá muito longo (máx. 30 caracteres).' : null;
}

export function phoneToPayload(raw: string): string | null {
  const value = raw.trim();
  return value === '' ? null : value;
}
