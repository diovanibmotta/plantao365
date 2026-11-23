import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth, RequireRole } from './auth/guards';
import { Layout } from './layout/Layout';
import { AuditPage } from './pages/AuditPage';
import { BalancePage } from './pages/BalancePage';
import { CollectiveVacationsPage } from './exceptions/CollectiveVacationsPage';
import { LoginPage } from './pages/LoginPage';
import { HolidaysPage } from './pages/HolidaysPage';
import { ScheduleAdminPage } from './pages/ScheduleAdminPage';
import { MembersPage } from './pages/MembersPage';
import { MySchedulePage } from './pages/MySchedulePage';
import { NotFoundPage } from './pages/pages';
import { ProfilePage } from './pages/ProfilePage';
import { SwapsPage } from './pages/SwapsPage';
import { TeamSchedulePage } from './pages/TeamSchedulePage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/minha-escala" replace />} />
          <Route path="minha-escala" element={<MySchedulePage />} />
          <Route path="escala" element={<TeamSchedulePage />} />
          <Route path="trocas" element={<SwapsPage />} />
          <Route path="saldo" element={<BalancePage />} />
          <Route path="perfil" element={<ProfilePage />} />
          <Route element={<RequireRole role="manager" />}>
            <Route path="equipe" element={<MembersPage />} />
            <Route path="ferias-coletivas" element={<CollectiveVacationsPage />} />
            <Route path="gerenciar-escala" element={<ScheduleAdminPage />} />
            <Route path="feriados" element={<HolidaysPage />} />
            <Route path="auditoria" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
