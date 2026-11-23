import type { Role } from '../auth/AuthContext';

export interface NavItem {
  to: string;
  label: string;
  role?: Role;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/minha-escala', label: 'Minha escala' },
  { to: '/escala', label: 'Escala' },
  { to: '/saldo', label: 'Saldo' },
  { to: '/gerenciar-escala', label: 'Gerenciar escala', role: 'manager' },
  { to: '/equipe', label: 'Equipe', role: 'manager' },
  { to: '/feriados', label: 'Feriados', role: 'manager' },
  { to: '/ferias-coletivas', label: 'Férias coletivas', role: 'manager' },
  { to: '/auditoria', label: 'Auditoria', role: 'manager' },
  { to: '/perfil', label: 'Perfil' },
];

export const navItemsFor = (role: Role): NavItem[] =>
  NAV_ITEMS.filter((item) => !item.role || item.role === role);
