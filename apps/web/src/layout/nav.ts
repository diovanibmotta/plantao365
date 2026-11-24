import type { Role } from '../auth/AuthContext';

export type NavIcon =
  | 'calendar-check'
  | 'grid'
  | 'repeat'
  | 'clock'
  | 'sliders'
  | 'users'
  | 'flag'
  | 'sun'
  | 'shield'
  | 'user';

export type NavGroup = 'schedule' | 'admin';

export interface NavItem {
  to: string;
  label: string;
  icon: NavIcon;
  group: NavGroup;
  role?: Role;
}

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  schedule: 'Plantão',
  admin: 'Gestão',
};

export const NAV_ITEMS: NavItem[] = [
  { to: '/my-schedule', label: 'Minha escala', icon: 'calendar-check', group: 'schedule' },
  { to: '/schedule', label: 'Calendário', icon: 'grid', group: 'schedule', role: 'guest' },
  { to: '/swaps', label: 'Trocas', icon: 'repeat', group: 'schedule' },
  { to: '/balance', label: 'Saldo', icon: 'clock', group: 'schedule' },
  {
    to: '/schedule-admin',
    label: 'Escala',
    icon: 'sliders',
    group: 'admin',
    role: 'manager',
  },
  { to: '/members', label: 'Equipe', icon: 'users', group: 'admin', role: 'manager' },
  { to: '/holidays', label: 'Feriados', icon: 'flag', group: 'admin', role: 'manager' },
  {
    to: '/vacations',
    label: 'Férias',
    icon: 'sun',
    group: 'admin',
    role: 'manager',
  },
  { to: '/audit', label: 'Auditoria', icon: 'shield', group: 'admin', role: 'manager' },
];

/** Perfil não tem item no menu: abre pela foto/nome do usuário no rodapé. */
export const PROFILE_PATH = '/profile';

const RANK: Record<Role, number> = { guest: 0, member: 1, manager: 2 };

/** Itens visíveis: sem `role` = membro ou acima; convidado só vê os marcados como 'guest'. */
export const navItemsFor = (role: Role): NavItem[] =>
  NAV_ITEMS.filter((item) => RANK[role] >= RANK[item.role ?? 'member']);
