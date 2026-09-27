import type { Invite, Role } from '@wayfinder/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { formatDate, formatRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { useInvites, useIsAdmin } from '../hooks';
import { PageHeader, QueryState, StatusPill } from './common';

const STATUS_KIND: Record<Invite['status'], 'ok' | 'idle' | 'warn' | 'bad'> = { unused: 'ok', used: 'idle', expired: 'warn', revoked: 'bad' };

export function InvitesPage() {
  const isAdmin = useIsAdmin();
  const [status, setStatus] = useState('');
  const invites = useInvites(status || undefined);
  const qc = useQueryClient();
  const toast = useToast();
  // Kept as typed, so the field can be cleared and retyped; clamped when sent.
  const [count, setCount] = useState('1');
  const [days, setDays] = useState('14');
  const [note, setNote] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [created, setCreated] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () =>
      api<{ codes: string[] }>('/api/admin/invites', {
        method: 'POST',
        body: { count: Math.max(1, Math.min(50, Math.round(Number(count)) || 1)), expiresInDays: days === 'never' ? null : Number(days), note: note.trim() || null, roleOnSignup: role },
      }),
    onSuccess: (r) => {
      setCreated(r.codes);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['admin', 'invites'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (code: string) => api(`/api/admin/invites/${encodeURIComponent(code)}/revoke`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'invites'] }),
    onError: (e) => toast(errorMessage(e)),
  });

  const linkFor = (code: string) => `${window.location.origin}/register?code=${encodeURIComponent(code)}`;
  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast(`${what} copied.`));

  return (
    <>
      <PageHeader title="Invite codes" description="People can only sign up with a code. Each code works once." />
      {isAdmin && (
        <section className="admin-section">
          <h2>Create codes</h2>
          <form
            className="invite-form"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <label className="field">
              <span className="field-label">How many</span>
              <input className="input" type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Expires</span>
              <select className="select" value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1">In 1 day</option>
                <option value="7">In 7 days</option>
                <option value="14">In 14 days</option>
                <option value="30">In 30 days</option>
                <option value="never">Never</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Account role</span>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="user">User</option>
                <option value="dev">Dev</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="field invite-note">
              <span className="field-label">Note (optional)</span>
              <input className="input" placeholder="Who it’s for" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              <Plus aria-hidden /> Create
            </button>
          </form>
          {role !== 'user' && <p className="notice notice-warning">Whoever uses these codes gets {role === 'admin' ? 'full admin' : 'read-only dashboard'} access.</p>}
          {create.error && <p className="notice notice-error">{errorMessage(create.error)}</p>}
          {created.length > 0 && (
            <div className="created-codes" role="status">
              <p>New codes:</p>
              <ul>
                {created.map((c) => (
                  <li key={c}>
                    <code className="code">{c}</code>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(c, 'Code')}><Copy aria-hidden /> Code</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(linkFor(c), 'Sign-up link')}><Link2 aria-hidden /> Link</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="admin-section">
        <div className="section-head">
          <h2>All codes</h2>
          <select className="select select-inline" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">Any status</option>
            <option value="unused">Unused</option>
            <option value="used">Used</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>
        <QueryState isLoading={invites.isLoading} error={invites.error} rows={5}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Status</th>
                  <th scope="col">Role</th>
                  <th scope="col">Note</th>
                  <th scope="col">Created</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Used by</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {invites.data?.items.map((i) => (
                  <tr key={i.code}>
                    <td><code className="code">{i.code}</code></td>
                    <td><StatusPill kind={STATUS_KIND[i.status]}>{i.status}</StatusPill></td>
                    <td>{i.roleOnSignup}</td>
                    <td className="muted">{i.note ?? '–'}</td>
                    <td className="num">{formatDate(i.createdAt)}{i.createdBy ? <span className="muted"> by {i.createdBy}</span> : null}</td>
                    <td className="num">{i.expiresAt ? formatDate(i.expiresAt) : 'Never'}</td>
                    <td>{i.usedByEmail ? <>{i.usedByEmail} <span className="muted num">{formatRelative(i.usedAt)}</span></> : '–'}</td>
                    <td className="num-col">
                      <div className="row-actions">
                        {i.status === 'unused' && (
                          <button type="button" className="icon-btn" aria-label={`Copy sign-up link for ${i.code}`} onClick={() => copy(linkFor(i.code), 'Sign-up link')}><Link2 /></button>
                        )}
                        {isAdmin && i.status === 'unused' && (
                          <button type="button" className="icon-btn" aria-label={`Revoke ${i.code}`} onClick={() => revoke.mutate(i.code)}><X /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {invites.data?.items.length === 0 && <tr><td colSpan={8} className="muted">No codes yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </QueryState>
      </section>
    </>
  );
}
