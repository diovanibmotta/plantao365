import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from './auth/AuthContext';
import { RequireAuth, RequireRole } from './auth/guards';
import { Layout } from './layout/Layout';
import { AuditPage } from './pages/AuditPage';
import { BalancePage } from './pages/BalancePage';
import { VacationsPage } from './exceptions/VacationsPage';
import { LoginPage } from './pages/LoginPage';
import { HolidayForm } from './holidays/HolidayForm';
import { HolidaysPage } from './pages/HolidaysPage';
import { ScheduleAdminPage } from './pages/ScheduleAdminPage';
import { ScheduleEditorPage } from './schedule-admin/ScheduleEditorPage';
import { ScheduleGenerateForm } from './schedule-admin/ScheduleGenerateForm';
import { ShiftExceptionForm } from './schedule-admin/ShiftExceptionForm';
import { ShiftTimeForm } from './schedule-admin/ShiftTimeForm';
import { WorkHoursForm } from './schedule-admin/WorkHoursForm';
import { MembersPage } from './pages/MembersPage';
import { MySchedulePage } from './pages/MySchedulePage';
import { NotFoundPage } from './pages/pages';
import { ProfilePage } from './pages/ProfilePage';
import { SwapsPage } from './pages/SwapsPage';
import { TeamSchedulePage } from './pages/TeamSchedulePage';
import { TeamsPage } from './pages/TeamsPage';
import { TeamForm } from './team/TeamForm';
import { TeamMembersPage } from './team/TeamMembersPage';

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

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'guest' ? '/schedule' : '/my-schedule'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="schedule" element={<TeamSchedulePage />} />
          <Route element={<RequireRole role="member" />}>
            <Route path="my-schedule" element={<MySchedulePage />} />
            <Route path="swaps" element={<SwapsPage />} />
            <Route path="balance" element={<BalancePage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
          <Route element={<RequireRole role="manager" />}>
            <Route path="teams" element={<TeamsPage />} />
            <Route path="teams/new" element={<TeamForm />} />
            <Route path="teams/:id" element={<TeamForm />} />
            <Route path="teams/:id/members" element={<TeamMembersPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="vacations" element={<VacationsPage />} />
            <Route path="schedule-admin" element={<ScheduleAdminPage />} />
            <Route path="schedule-admin/schedules/new" element={<ScheduleGenerateForm />} />
            <Route path="schedule-admin/schedules/:id" element={<ScheduleEditorPage />} />
            <Route path="schedule-admin/shift-times/new" element={<ShiftTimeForm />} />
            <Route path="schedule-admin/shift-times/:key" element={<ShiftTimeForm />} />
            <Route path="schedule-admin/work-hours/new" element={<WorkHoursForm />} />
            <Route path="schedule-admin/work-hours/:position" element={<WorkHoursForm />} />
            <Route path="schedule-admin/exceptions/new" element={<ShiftExceptionForm />} />
            <Route path="schedule-admin/exceptions/:date" element={<ShiftExceptionForm />} />
            <Route path="holidays" element={<HolidaysPage />} />
            <Route path="holidays/new" element={<HolidayForm />} />
            <Route path="holidays/:id" element={<HolidayForm />} />
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
