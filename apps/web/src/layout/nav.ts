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
  { to: '/minha-escala', label: 'Minha escala', icon: 'calendar-check', group: 'schedule' },
  { to: '/escala', label: 'Calendário', icon: 'grid', group: 'schedule' },
  { to: '/trocas', label: 'Trocas', icon: 'repeat', group: 'schedule' },
  { to: '/saldo', label: 'Saldo', icon: 'clock', group: 'schedule' },
  {
    to: '/gerenciar-escala',
    label: 'Escala',
    icon: 'sliders',
    group: 'admin',
    role: 'manager',
  },
  { to: '/equipe', label: 'Equipe', icon: 'users', group: 'admin', role: 'manager' },
  { to: '/feriados', label: 'Feriados', icon: 'flag', group: 'admin', role: 'manager' },
  {
    to: '/ferias',
    label: 'Férias',
    icon: 'sun',
    group: 'admin',
    role: 'manager',
  },
  { to: '/auditoria', label: 'Auditoria', icon: 'shield', group: 'admin', role: 'manager' },
];

/** Perfil não tem item no menu: abre pela foto/nome do usuário no rodapé. */
export const PROFILE_PATH = '/perfil';

export const navItemsFor = (role: Role): NavItem[] =>
  NAV_ITEMS.filter((item) => !item.role || item.role === role);
