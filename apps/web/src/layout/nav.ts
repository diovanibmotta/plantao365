import type { PluginNavItem } from '@plantao365/web-sdk';
import type { Role } from '../auth/AuthContext';

export type NavIcon =
  | 'calendar-check'
  | 'calendar-days'
  | 'repeat'
  | 'clock'
  | 'sliders'
  | 'users'
  | 'layers'
  | 'calendar-star'
  | 'plane'
  | 'shield'
  | 'puzzle'
  | 'user';

export type NavGroup = 'schedule' | 'admin' | 'settings';

export interface NavItem {
  to: string;
  label: string;
  icon: NavIcon;
  /** Ícone de plugin: dados `d` de paths SVG, desenhados na mesma moldura dos nativos. */
  iconPaths?: string[];
  group: NavGroup;
  role?: Role;
}

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  schedule: 'Plantão',
  admin: 'Gestão',
  settings: 'Configuração',
};

export const NAV_ITEMS: NavItem[] = [
  { to: '/my-schedule', label: 'Plantão', icon: 'calendar-check', group: 'schedule' },
  { to: '/schedule', label: 'Calendário', icon: 'calendar-days', group: 'schedule', role: 'guest' },
  { to: '/swaps', label: 'Trocas', icon: 'repeat', group: 'schedule' },
  { to: '/balance', label: 'Saldo', icon: 'clock', group: 'schedule' },
  {
    to: '/schedule-admin',
    label: 'Escala',
    icon: 'sliders',
    group: 'admin',
    role: 'manager',
  },
  { to: '/teams', label: 'Equipes', icon: 'layers', group: 'admin', role: 'manager' },
  { to: '/members', label: 'Membros', icon: 'users', group: 'admin', role: 'manager' },
  { to: '/holidays', label: 'Feriados', icon: 'calendar-star', group: 'admin', role: 'manager' },
  {
    to: '/vacations',
    label: 'Férias',
    icon: 'plane',
    group: 'admin',
    role: 'manager',
  },
  { to: '/audit', label: 'Auditoria', icon: 'shield', group: 'admin', role: 'manager' },
  { to: '/plugins', label: 'Plugins', icon: 'puzzle', group: 'settings', role: 'manager' },
];

/** Perfil não tem item no menu: abre pela foto/nome do usuário no rodapé. */
export const PROFILE_PATH = '/profile';

const RANK: Record<Role, number> = { guest: 0, member: 1, manager: 2 };

/** Itens visíveis: sem `role` = membro ou acima; convidado só vê os marcados como 'guest'. */
export const navItemsFor = (role: Role, extra: NavItem[] = []): NavItem[] =>
  [...NAV_ITEMS, ...extra].filter((item) => RANK[role] >= RANK[item.role ?? 'member']);

/** Itens de menu declarados pelos plugins, em `/ext/<id>/<path>`. */
export const pluginNavItems = (
  plugins: { id: string; module: { nav?: PluginNavItem[] } | null }[],
): NavItem[] =>
  plugins.flatMap((p) =>
    (p.module?.nav ?? []).map((item) => ({
      to: `/ext/${p.id}${item.path ? `/${item.path}` : ''}`,
      label: item.label,
      icon: 'layers' as const,
      ...(item.icon && { iconPaths: item.icon }),
      group: item.group,
      ...(item.role && { role: item.role }),
    })),
  );
