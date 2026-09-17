import { useState } from 'react';
import { Link } from 'react-router';
import { formatDateTime } from '../../lib/format';
import { useAudit } from '../hooks';
import { PageHeader, QueryState } from './common';

const ACTIONS: Record<string, string> = {
  'user.view': 'Viewed user',
  'user.view_trips': 'Viewed trips',
  'user.view_trip': 'Viewed a trip',
  'user.view_coverage': 'Viewed coverage',
  'user.role_change': 'Changed role',
  'user.disable': 'Disabled account',
  'user.enable': 'Enabled account',
  'user.delete': 'Deleted account',
  'user.self_delete': 'Deleted own account',
  'user.restore': 'Restored account',
  'user.revoke_sessions': 'Signed out everywhere',
  'user.reset_link': 'Created reset link',
  'user.create_admin': 'Created admin (CLI)',
  'trip.delete': 'Deleted trip',
  'trip.restore': 'Restored trip',
  'coverage.rebuild': 'Rebuilt coverage',
  'invite.create': 'Created invites',
  'invite.revoke': 'Revoked invite',
  'job.retry': 'Retried job',
  'pipeline.refresh': 'Started data refresh',
  'app.settings_change': 'Changed app settings',
};

export function AuditPage() {
  const [action, setAction] = useState('');
  const audit = useAudit({ action: action || undefined, limit: 300 });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every admin action and every look at another user’s data. Entries can’t be edited or deleted."
        actions={
          <select className="select" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
            <option value="">All actions</option>
            <option value="user.view">Data views</option>
            <option value="user.">User changes and views</option>
            <option value="trip.">Trips</option>
            <option value="invite.">Invites</option>
            <option value="app.">App settings</option>
            <option value="pipeline.">Data pipeline</option>
          </select>
        }
      />
      <QueryState isLoading={audit.isLoading} error={audit.error} rows={8}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.data?.items.map((a) => (
                <tr key={a.id}>
                  <td className="num">{formatDateTime(a.createdAt)}</td>
                  <td>{a.actorEmail ?? (a.actorId ? a.actorId.slice(0, 8) : 'System / CLI')}</td>
                  <td>{ACTIONS[a.action] ?? a.action}</td>
                  <td>
                    {a.targetType === 'user' && a.targetId ? <Link to={`/admin/users/${a.targetId}`}>User {a.targetId.slice(0, 8)}</Link> : a.targetId ? <code>{a.targetId}</code> : '–'}
                  </td>
                  <td className="details-cell">{Object.keys(a.details).length ? <code>{JSON.stringify(a.details)}</code> : '–'}</td>
                </tr>
              ))}
              {audit.data?.items.length === 0 && <tr><td colSpan={5} className="muted">Nothing logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </QueryState>
    </>
  );
}
