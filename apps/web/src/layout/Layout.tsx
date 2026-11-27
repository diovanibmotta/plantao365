import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { APP_NAME } from '@diovanibmotta/plantao365-shared';
import { useAuth } from '../auth/AuthContext';
import { TeamProvider, useRole, useTeam } from '../team/TeamContext';
import { effectiveTheme, setTheme, type Theme } from '../theme';
import { Avatar } from './Avatar';
import { ConfigWarningsBanner } from './ConfigWarningsBanner';
import { BrandMark, Icon } from './icons';
import { NAV_GROUP_LABELS, PROFILE_PATH, navItemsFor, pluginNavItems, type NavGroup } from './nav';
import { PluginProvider, usePlugins } from '../plugins/PluginContext';

const GROUP_ORDER: NavGroup[] = ['schedule', 'admin'];

function ThemeToggle() {
  const [theme, setCurrent] = useState<Theme>(effectiveTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={next === 'light' ? 'Usar tema claro' : 'Usar tema escuro'}
      title={next === 'light' ? 'Tema claro' : 'Tema escuro'}
      onClick={() => {
        setTheme(next);
        setCurrent(next);
      }}
    >
      <Icon name={theme === 'dark' ? 'sun-mode' : 'moon'} />
    </button>
  );
}

/** Só escolhe a equipe exibida; o cadastro (CRUD) fica na página Equipes. */
function TeamSwitcher() {
  const { teams, activeTeam, select } = useTeam();

  if (teams.length === 0) return null;
  if (teams.length === 1 && activeTeam) {
    return (
      <div className="team-switch">
        <span className="team-label">Equipe</span>
        <span className="team-single">{activeTeam.name}</span>
      </div>
    );
  }

  return (
    <div className="team-switch">
      <label className="team-label" htmlFor="team-select">
        Equipe
      </label>
      <div className="team-row">
        <select
          id="team-select"
          value={activeTeam?.id ?? ''}
          onChange={(e) => select(e.target.value)}
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function Layout() {
  return (
    <TeamProvider>
      <PluginProvider>
        <LayoutShell />
      </PluginProvider>
    </TeamProvider>
  );
}

function LayoutShell() {
  const { user, logout } = useAuth();
  const { activeTeam, loading } = useTeam();
  const role = useRole();
  const { plugins } = usePlugins();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Esc fecha o drawer no mobile.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!user || !role) return null;
  const items = navItemsFor(role, pluginNavItems(plugins));
  const roleLabel = user.isMaster
    ? 'Master'
    : { manager: 'Gestor', member: 'Membro', guest: 'Convidado' }[role];
  const current = pathname.startsWith(PROFILE_PATH)
    ? { label: 'Perfil' }
    : items.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));

  return (
    <>
      {role === 'manager' && <ConfigWarningsBanner />}
      <div className="app">
        <a className="skip-link" href="#conteudo">
          Ir para o conteúdo
        </a>
        <aside id="sidebar" className={open ? 'sidebar open' : 'sidebar'}>
          <div className="sidebar-head">
            <span className="brand">
              <BrandMark />
              {APP_NAME}
            </span>
            <button
              type="button"
              className="icon-btn sidebar-close"
              aria-label="Fechar menu"
              onClick={() => setOpen(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <nav aria-label="Principal" className="sidebar-nav" onClick={() => setOpen(false)}>
            {GROUP_ORDER.map((group) => {
              const groupItems = items.filter((item) => item.group === group);
              if (groupItems.length === 0) return null;
              return (
                <div key={group} className="nav-group">
                  <p className="nav-group-label" aria-hidden="true">
                    {NAV_GROUP_LABELS[group]}
                  </p>
                  <ul>
                    {groupItems.map((item) => (
                      <li key={item.to}>
                        <NavLink to={item.to}>
                          <Icon name={item.icon} paths={item.iconPaths} />
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
          <TeamSwitcher />
          <div className="sidebar-foot">
            <NavLink
              to={role === 'guest' ? '/schedule' : PROFILE_PATH}
              className="who-link"
              title={role === 'guest' ? user.email : 'Meu perfil'}
              onClick={() => setOpen(false)}
            >
              <Avatar userId={user.id} name={user.name} />
              <span className="who">
                <span className="who-name">{user.name}</span>
                <span className="who-role">{roleLabel}</span>
              </span>
            </NavLink>
            <ThemeToggle />
            <button type="button" className="btn sm" onClick={() => void logout()}>
              Sair
            </button>
          </div>
        </aside>
        {open && <div className="scrim" aria-hidden="true" onClick={() => setOpen(false)} />}
        <div className="main-col">
          <header className="topbar">
            <button
              type="button"
              className="icon-btn menu-toggle"
              aria-label="Abrir menu"
              aria-expanded={open}
              aria-controls="sidebar"
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name="menu" />
            </button>
            <span className="crumb">
              <span className="crumb-root">{APP_NAME}</span>
              {current && (
                <>
                  <span className="crumb-sep" aria-hidden="true">
                    /
                  </span>
                  <span className="crumb-current">{current.label}</span>
                </>
              )}
            </span>
          </header>
          <main id="conteudo" className="content" tabIndex={-1}>
            {loading ? null : <Outlet key={activeTeam?.id ?? 'none'} />}
          </main>
        </div>
      </div>
    </>
  );
}
