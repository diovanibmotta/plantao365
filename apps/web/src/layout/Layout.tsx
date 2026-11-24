import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { APP_NAME } from '@diovanibmotta/plantao365-shared';
import { useAuth } from '../auth/AuthContext';
import { effectiveTheme, setTheme, type Theme } from '../theme';
import { BrandMark, Icon } from './icons';
import { NAV_GROUP_LABELS, PROFILE_PATH, navItemsFor, type NavGroup } from './nav';

const GROUP_ORDER: NavGroup[] = ['schedule', 'admin'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]!, parts[parts.length - 1]!] : parts;
  return letters.map((p) => p[0]!.toUpperCase()).join('') || '?';
}

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

export function Layout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Esc fecha o drawer no mobile.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!user) return null;
  const items = navItemsFor(user.role);
  const current = pathname.startsWith(PROFILE_PATH)
    ? { label: 'Perfil' }
    : items.find((item) => pathname.startsWith(item.to));

  return (
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
                        <Icon name={item.icon} />
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <NavLink
            to={PROFILE_PATH}
            className="who-link"
            title="Meu perfil"
            onClick={() => setOpen(false)}
          >
            <span className="avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <span className="who">
              <span className="who-name">{user.name}</span>
              <span className="who-role">{user.role === 'manager' ? 'Gestor' : 'Membro'}</span>
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
