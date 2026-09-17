import { Activity, ArrowLeft, Bug, Cog, Gauge, History, KeyRound, Layers, Trash2, Users, UsersRound } from 'lucide-react';
import { NavLink, Route, Routes } from 'react-router';
import { useAuth } from '../lib/auth';
import { useAppConfig } from '../lib/config';
import { AppSettingsPage } from './pages/AppSettingsPage';
import { AuditPage } from './pages/AuditPage';
import { DeletedPage } from './pages/DeletedPage';
import { ErrorsPage } from './pages/ErrorsPage';
import { InvitesPage } from './pages/InvitesPage';
import { JobsPage } from './pages/JobsPage';
import { OverviewPage } from './pages/OverviewPage';
import { PerformancePage } from './pages/PerformancePage';
import { UsagePage } from './pages/UsagePage';
import { UserDetailPage } from './pages/UserDetailPage';
import { UsersPage } from './pages/UsersPage';

const NAV = [
  { group: 'Monitoring', items: [
    { to: '/admin', label: 'Overview', icon: Gauge, end: true },
    { to: '/admin/performance', label: 'Performance', icon: Activity },
    { to: '/admin/errors', label: 'Errors', icon: Bug },
    { to: '/admin/jobs', label: 'Jobs & data', icon: Layers },
    { to: '/admin/usage', label: 'Usage', icon: UsersRound },
  ] },
  { group: 'Management', items: [
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/invites', label: 'Invite codes', icon: KeyRound },
    { to: '/admin/audit', label: 'Audit log', icon: History },
    { to: '/admin/deleted', label: 'Recently deleted', icon: Trash2 },
    { to: '/admin/settings', label: 'App settings', icon: Cog },
  ] },
];

export default function AdminApp() {
  const { user } = useAuth();
  const { config } = useAppConfig();
  return (
    <div className="admin">
      <aside className="admin-side">
        <div className="admin-brand">
          <span className="brand-name">{config.appName}</span>
          <span className="badge badge-accent">{user?.role === 'admin' ? 'Admin' : 'Dev (read-only)'}</span>
        </div>
        <nav aria-label="Admin">
          {NAV.map((g) => (
            <div key={g.group} className="admin-nav-group">
              <p className="admin-nav-title">{g.group}</p>
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="admin-nav-link">
                  <Icon aria-hidden /> {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <NavLink to="/directions" className="admin-nav-link admin-back">
          <ArrowLeft aria-hidden /> Back to the map
        </NavLink>
      </aside>
      <main className="admin-main">
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="performance" element={<PerformancePage />} />
          <Route path="errors" element={<ErrorsPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserDetailPage />} />
          <Route path="invites" element={<InvitesPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="deleted" element={<DeletedPage />} />
          <Route path="settings" element={<AppSettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
