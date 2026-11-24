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

export type NavGroup = 'schedule' | 'admin' | 'account';

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
  account: 'Conta',
};

export const NAV_ITEMS: NavItem[] = [
  { to: '/minha-escala', label: 'Minha escala', icon: 'calendar-check', group: 'schedule' },
  { to: '/escala', label: 'Escala', icon: 'grid', group: 'schedule' },
  { to: '/trocas', label: 'Trocas', icon: 'repeat', group: 'schedule' },
  { to: '/saldo', label: 'Saldo', icon: 'clock', group: 'schedule' },
  {
    to: '/gerenciar-escala',
    label: 'Gerenciar escala',
    icon: 'sliders',
    group: 'admin',
    role: 'manager',
  },
  { to: '/equipe', label: 'Equipe', icon: 'users', group: 'admin', role: 'manager' },
  { to: '/feriados', label: 'Feriados', icon: 'flag', group: 'admin', role: 'manager' },
  {
    to: '/ferias-coletivas',
    label: 'Férias coletivas',
    icon: 'sun',
    group: 'admin',
    role: 'manager',
  },
  { to: '/auditoria', label: 'Auditoria', icon: 'shield', group: 'admin', role: 'manager' },
  { to: '/perfil', label: 'Perfil', icon: 'user', group: 'account' },
];

export const navItemsFor = (role: Role): NavItem[] =>
  NAV_ITEMS.filter((item) => !item.role || item.role === role);
