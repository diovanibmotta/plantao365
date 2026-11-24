import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth, RequireRole } from './auth/guards';
import { Layout } from './layout/Layout';
import { AuditPage } from './pages/AuditPage';
import { BalancePage } from './pages/BalancePage';
import { VacationsPage } from './exceptions/VacationsPage';
import { LoginPage } from './pages/LoginPage';
import { HolidaysPage } from './pages/HolidaysPage';
import { ScheduleAdminPage } from './pages/ScheduleAdminPage';
import { MembersPage } from './pages/MembersPage';
import { MySchedulePage } from './pages/MySchedulePage';
import { NotFoundPage } from './pages/pages';
import { ProfilePage } from './pages/ProfilePage';
import { SwapsPage } from './pages/SwapsPage';
import { TeamSchedulePage } from './pages/TeamSchedulePage';

/** Rotas antigas em português: mantêm vivos links de e-mails já enviados e favoritos. */
const LEGACY_PATHS: Record<string, string> = {
  'minha-escala': '/my-schedule',
  escala: '/schedule',
  trocas: '/swaps',
  saldo: '/balance',
  perfil: '/profile',
  equipe: '/members',
  ferias: '/vacations',
  'ferias-coletivas': '/vacations',
  'gerenciar-escala': '/schedule-admin',
  feriados: '/holidays',
  auditoria: '/audit',
};

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/my-schedule" replace />} />
          <Route path="my-schedule" element={<MySchedulePage />} />
          <Route path="schedule" element={<TeamSchedulePage />} />
          <Route path="swaps" element={<SwapsPage />} />
          <Route path="balance" element={<BalancePage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route element={<RequireRole role="manager" />}>
            <Route path="members" element={<MembersPage />} />
            <Route path="vacations" element={<VacationsPage />} />
            <Route path="schedule-admin" element={<ScheduleAdminPage />} />
            <Route path="holidays" element={<HolidaysPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
          {Object.entries(LEGACY_PATHS).map(([from, to]) => (
            <Route key={from} path={from} element={<Navigate to={to} replace />} />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
