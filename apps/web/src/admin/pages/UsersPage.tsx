import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatDate, formatNumber, formatRelative } from '../../lib/format';
import { useUsers } from '../hooks';
import { PageHeader, QueryState, StatusPill } from './common';

const PAGE = 50;

export function UsersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [offset, setOffset] = useState(0);
  const users = useUsers({ q: q || undefined, status, limit: PAGE, offset });
  const total = users.data?.total ?? 0;
  return (
    <>
      <PageHeader title="Users" description="Viewing a user’s trips or coverage is recorded in the audit log." />
      <div className="toolbar">
        <label className="toolbar-search">
          <Search aria-hidden />
          <span className="visually-hidden">Search by email</span>
          <input className="input" placeholder="Search by email" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        </label>
        <select className="select select-inline" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} aria-label="Status">
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="deleted">Deleted</option>
        </select>
      </div>
      <QueryState isLoading={users.isLoading} error={users.error} rows={6}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Joined</th>
                <th scope="col">Last seen</th>
                <th scope="col" className="num-col">Trips</th>
                <th scope="col" className="num-col">Hexagons</th>
                <th scope="col">Tracking</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.items.map((u) => (
                <tr key={u.id}>
                  <td><Link to={`/admin/users/${u.id}`}>{u.email}</Link></td>
                  <td>{u.role === 'user' ? 'User' : u.role === 'dev' ? 'Dev' : 'Admin'}</td>
                  <td>
                    {u.deletedAt ? <StatusPill kind="bad">Deleted</StatusPill> : u.disabledAt ? <StatusPill kind="warn">Disabled</StatusPill> : <StatusPill kind="ok">Active</StatusPill>}
                  </td>
                  <td className="num">{formatDate(u.createdAt)}</td>
                  <td className="num">{formatRelative(u.lastSeenAt)}</td>
                  <td className="num-col num">{formatNumber(u.tripCount)}</td>
                  <td className="num-col num">{formatNumber(u.cellCount)}</td>
                  <td>{u.settings.trackingEnabled ? 'On' : 'Off'}</td>
                </tr>
              ))}
              {users.data?.items.length === 0 && (
                <tr><td colSpan={8} className="muted">No users match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="num muted">{total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}` : ''}</span>
          <button type="button" className="icon-btn" aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}><ChevronLeft /></button>
          <button type="button" className="icon-btn" aria-label="Next page" disabled={offset + PAGE >= total} onClick={() => setOffset((o) => o + PAGE)}><ChevronRight /></button>
        </div>
      </QueryState>
    </>
  );
}
