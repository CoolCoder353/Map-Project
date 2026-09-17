import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { useDeleted, useIsAdmin } from '../hooks';
import { PageHeader, QueryState } from './common';

export function DeletedPage() {
  const deleted = useDeleted();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const restore = useMutation({
    mutationFn: (x: { kind: 'user' | 'trip'; id: string }) =>
      api(x.kind === 'user' ? `/api/admin/users/${x.id}/restore` : `/api/admin/trips/${x.id}/restore`, { method: 'POST' }),
    onSuccess: (_d, x) => {
      toast(x.kind === 'user' ? 'Account restored.' : 'Trip restored. Coverage is rebuilding.');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const d = deleted.data;
  return (
    <>
      <PageHeader title="Recently deleted" description="Deleted accounts and trips stay restorable for 7 days, then they’re removed permanently." />
      <QueryState isLoading={deleted.isLoading} error={deleted.error}>
        <section className="admin-section">
          <h2>Accounts</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Deleted</th>
                <th scope="col">Removed for good</th>
                {isAdmin && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {d?.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td className="num">{formatRelative(u.deletedAt)}</td>
                  <td className="num">{formatDateTime(u.purgeAt)}</td>
                  {isAdmin && (
                    <td className="num-col">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => restore.mutate({ kind: 'user', id: u.id })}><RotateCcw aria-hidden /> Restore</button>
                    </td>
                  )}
                </tr>
              ))}
              {d?.users.length === 0 && <tr><td colSpan={4} className="muted">No deleted accounts.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="admin-section">
          <h2>Trips</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Owner</th>
                <th scope="col">Trip started</th>
                <th scope="col">Deleted</th>
                <th scope="col">Removed for good</th>
                {isAdmin && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {d?.trips.map((t) => (
                <tr key={t.id}>
                  <td>{t.userEmail}</td>
                  <td className="num">{formatDateTime(t.startedAt)}</td>
                  <td className="num">{formatRelative(t.deletedAt)}</td>
                  <td className="num">{formatDateTime(t.purgeAt)}</td>
                  {isAdmin && (
                    <td className="num-col">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => restore.mutate({ kind: 'trip', id: t.id })}><RotateCcw aria-hidden /> Restore</button>
                    </td>
                  )}
                </tr>
              ))}
              {d?.trips.length === 0 && <tr><td colSpan={5} className="muted">No deleted trips.</td></tr>}
            </tbody>
          </table>
        </section>
      </QueryState>
    </>
  );
}
