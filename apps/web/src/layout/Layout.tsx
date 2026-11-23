import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { APP_NAME } from '@diovanibmotta/plantao365-shared';
import { useAuth } from '../auth/AuthContext';
import { navItemsFor } from './nav';

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;
  return (
    <div className="shell">
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>
      <header className="topbar">
        <span className="brand">{APP_NAME}</span>
        <button
          type="button"
          className="btn menu-toggle"
          aria-expanded={open}
          aria-controls="menu-principal"
          onClick={() => setOpen((v) => !v)}
        >
          Menu
        </button>
        <nav
          id="menu-principal"
          aria-label="Principal"
          className={open ? 'nav open' : 'nav'}
          onClick={() => setOpen(false)}
        >
          <ul>
            {navItemsFor(user.role).map((item) => (
              <li key={item.to}>
                <NavLink to={item.to}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="user">
          <span className="user-name">{user.name}</span>
          <button type="button" className="btn" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </header>
      <main id="conteudo" className="content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
