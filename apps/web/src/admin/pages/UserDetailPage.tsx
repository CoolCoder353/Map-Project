import type { LngLat, Role, TripDetail, TripSummary } from '@wayfinder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Copy, Hexagon, KeyRound, LogOut, RotateCcw, Trash2, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime, formatDistanceShort, formatNumber, formatRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { MapProvider, useMapApi } from '../../map/MapProvider';
import { useAdminUser, useIsAdmin } from '../hooks';
import { PageHeader, QueryState, StatusPill } from './common';

type Pending =
  | { kind: 'role'; role: Role }
  | { kind: 'disable' }
  | { kind: 'delete' }
  | { kind: 'delete-trip'; tripId: string }
  | null;

export function UserDetailPage() {
  const { id = '' } = useParams();
  const { user: me } = useAuth();
  const isAdmin = useIsAdmin();
  const user = useAdminUser(id);
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<string | null>(null);

  const trips = useQuery({
    queryKey: ['admin', 'user-trips', id],
    queryFn: () => api<{ items: TripSummary[] }>(`/api/admin/users/${id}/trips`, { query: { limit: 100 } }),
    enabled: user.isSuccess,
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'user', id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'user-trips', id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  };

  const action = useMutation({
    mutationFn: async ({ p, typed }: { p: NonNullable<Pending>; typed: string }) => {
      switch (p.kind) {
        case 'role':
          return api(`/api/admin/users/${id}`, { method: 'PATCH', body: { role: p.role, confirm: typed } });
        case 'disable':
          return api(`/api/admin/users/${id}`, { method: 'PATCH', body: { disabled: true } });
        case 'delete':
          return api(`/api/admin/users/${id}`, { method: 'DELETE', body: { confirm: typed } });
        case 'delete-trip':
          return api(`/api/admin/users/${id}/trips/${p.tripId}`, { method: 'DELETE', body: { confirm: typed } });
      }
    },
    onSuccess: (_d, { p }) => {
      setPending(null);
      toast(
        p.kind === 'role' ? 'Role changed. Their sessions were signed out.' : p.kind === 'disable' ? 'Account disabled and signed out.' : p.kind === 'delete' ? 'Account deleted. Restorable for 7 days.' : 'Trip deleted. Restorable for 7 days.',
      );
      if (p.kind === 'delete-trip') setSelectedTrip(null);
      invalidate();
    },
  });

  const simple = useMutation({
    mutationFn: (kind: 'enable' | 'revoke' | 'reset' | 'restore' | 'rebuild') => {
      if (kind === 'enable') return api(`/api/admin/users/${id}`, { method: 'PATCH', body: { disabled: false } });
      if (kind === 'revoke') return api(`/api/admin/users/${id}/revoke-sessions`, { method: 'POST' });
      if (kind === 'restore') return api(`/api/admin/users/${id}/restore`, { method: 'POST' });
      if (kind === 'rebuild') return api(`/api/admin/users/${id}/coverage/rebuild`, { method: 'POST' });
      return api<{ url: string }>(`/api/admin/users/${id}/reset-password-link`, { method: 'POST' });
    },
    onSuccess: (data, kind) => {
      if (kind === 'reset') setResetLink((data as { url: string }).url);
      else toast({ enable: 'Account enabled.', revoke: 'All sessions signed out.', restore: 'Account restored.', rebuild: 'Coverage rebuild queued.' }[kind]);
      invalidate();
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const u = user.data;
  const self = me?.id === id;
  return (
    <>
      <Link to="/admin/users" className="back-link">
        <ArrowLeft aria-hidden /> Users
      </Link>
      <QueryState isLoading={user.isLoading} error={user.error}>
        {u && (
          <>
            <PageHeader
              title={u.email}
              description={`Joined ${formatDate(u.createdAt)} · last seen ${formatRelative(u.lastSeenAt, { midSentence: true })}`}
              actions={
                u.deletedAt ? <StatusPill kind="bad">Deleted {formatRelative(u.deletedAt)}</StatusPill> : u.disabledAt ? <StatusPill kind="warn">Disabled</StatusPill> : <StatusPill kind="ok">Active</StatusPill>
              }
            />

            <section className="admin-section">
              <h2>Account</h2>
              <dl className="kv-grid">
                <div><dt>Role</dt><dd>{u.role === 'user' ? 'User' : u.role === 'dev' ? 'Dev (read-only dashboard)' : 'Admin'}</dd></div>
                <div><dt>Trips</dt><dd className="num">{formatNumber(u.tripCount)}</dd></div>
                <div><dt>Hexagons explored</dt><dd className="num">{formatNumber(u.cellCount)}</dd></div>
                <div><dt>Background tracking</dt><dd>{u.settings.trackingEnabled ? 'On' : 'Off'}</dd></div>
                <div><dt>Default mode</dt><dd>{u.settings.defaultMode === 'car' ? 'Drive' : 'Walk'}</dd></div>
                <div><dt>Explore budget</dt><dd className="num">{u.settings.exploreBudgetMin} min</dd></div>
              </dl>
              {isAdmin && !u.deletedAt && (
                <div className="action-row">
                  <label className="inline-field">
                    <span>Role</span>
                    <select className="select select-inline" value={u.role} disabled={self} onChange={(e) => setPending({ kind: 'role', role: e.target.value as Role })}>
                      <option value="user">User</option>
                      <option value="dev">Dev</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                  {u.disabledAt ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => simple.mutate('enable')}><UserCheck aria-hidden /> Enable</button>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={self} onClick={() => setPending({ kind: 'disable' })}><Ban aria-hidden /> Disable</button>
                  )}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => simple.mutate('revoke')}><LogOut aria-hidden /> Sign out everywhere</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => simple.mutate('reset')}><KeyRound aria-hidden /> Password reset link</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => simple.mutate('rebuild')}><Hexagon aria-hidden /> Rebuild coverage</button>
                  <button type="button" className="btn btn-danger-outline btn-sm" disabled={self} onClick={() => setPending({ kind: 'delete' })}><Trash2 aria-hidden /> Delete account</button>
                </div>
              )}
              {isAdmin && u.deletedAt && (
                <div className="action-row">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => simple.mutate('restore')}><RotateCcw aria-hidden /> Restore account</button>
                </div>
              )}
              {self && <p className="field-hint">You can’t change your own role or status here.</p>}
              {resetLink && (
                <div className="notice">
                  <div style={{ display: 'grid', gap: 8, flex: 1, minWidth: 0 }}>
                    <span>Send this link to {u.email}. It works once and expires in 24 hours.</span>
                    <code className="copyable">{resetLink}</code>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void navigator.clipboard.writeText(resetLink).then(() => toast('Link copied.'))}><Copy aria-hidden /> Copy</button>
                </div>
              )}
            </section>

            <section className="admin-section">
              <h2>Where they’ve been</h2>
              <p className="field-hint">Opening this map and any trip is recorded in the audit log.</p>
              <MapProvider coverageUrl={`/api/admin/users/${id}/coverage`} insetForPanel={false}>
                <div className="admin-map-layout">
                  <UserMap userId={id} tripId={selectedTrip} />
                  <div className="admin-trips">
                    <QueryState isLoading={trips.isLoading} error={trips.error}>
                      {trips.data?.items.length === 0 && <p className="empty">No trips.</p>}
                      <ul className="trip-list">
                        {trips.data?.items.map((t) => (
                          <li key={t.id} className={`admin-trip ${selectedTrip === t.id ? 'is-selected' : ''}`}>
                            <button type="button" className="trip-row" aria-pressed={selectedTrip === t.id} onClick={() => setSelectedTrip(t.id)}>
                              <span className="place-body">
                                <span className="place-name num">{formatDateTime(t.startedAt)}</span>
                                <span className="place-meta num">
                                  {t.mode === 'car' ? 'Drive' : 'Walk'} · {formatDistanceShort(t.distanceM)} · {t.newCells} new
                                </span>
                              </span>
                            </button>
                            {isAdmin && (
                              <button type="button" className="icon-btn" aria-label="Delete trip" onClick={() => setPending({ kind: 'delete-trip', tripId: t.id })}>
                                <Trash2 />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </QueryState>
                  </div>
                </div>
              </MapProvider>
            </section>

            <section className="admin-section">
              <h2>Sessions</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Signed in</th>
                      <th scope="col">Expires</th>
                      <th scope="col">Status</th>
                      <th scope="col">Device</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.sessions.map((s) => (
                      <tr key={s.id}>
                        <td className="num">{formatDateTime(s.createdAt)}</td>
                        <td className="num">{formatDate(s.expiresAt)}</td>
                        <td>{s.revokedAt ? <StatusPill kind="idle">Ended</StatusPill> : new Date(s.expiresAt) < new Date() ? <StatusPill kind="idle">Expired</StatusPill> : <StatusPill kind="ok">Active</StatusPill>}</td>
                        <td className="muted ua">{s.userAgent ?? '–'}</td>
                      </tr>
                    ))}
                    {u.sessions.length === 0 && <tr><td colSpan={4} className="muted">No sessions.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <ConfirmDialog
              open={pending !== null}
              title={
                pending?.kind === 'role' ? `Change role to ${pending.role}?` : pending?.kind === 'disable' ? 'Disable this account?' : pending?.kind === 'delete' ? 'Delete this account?' : 'Delete this trip?'
              }
              body={
                pending?.kind === 'role' ? (
                  <p>{pending.role === 'user' ? 'They lose dashboard access.' : pending.role === 'dev' ? 'They can view the dashboard, including other users’ trips, but can’t change anything.' : 'They get full control, including deleting data and changing roles.'} They’ll be signed out everywhere.</p>
                ) : pending?.kind === 'disable' ? (
                  <p>They’re signed out and can’t sign in until re-enabled. Their data stays.</p>
                ) : pending?.kind === 'delete' ? (
                  <p>The account can’t sign in. Everything they’ve recorded is removed permanently after 7 days unless restored.</p>
                ) : (
                  <p>The trip leaves their history and coverage. Restorable for 7 days from Recently deleted.</p>
                )
              }
              confirmLabel={pending?.kind === 'role' ? 'Change role' : pending?.kind === 'disable' ? 'Disable' : 'Delete'}
              typeToConfirm={pending?.kind === 'role' || pending?.kind === 'delete' ? u.email : pending?.kind === 'delete-trip' ? 'DELETE' : undefined}
              danger={pending?.kind !== 'role'}
              busy={action.isPending}
              error={action.error ? errorMessage(action.error) : null}
              onConfirm={(typed) => pending && action.mutate({ p: pending, typed })}
              onCancel={() => {
                setPending(null);
                action.reset();
              }}
            />
          </>
        )}
      </QueryState>
    </>
  );
}

function UserMap({ userId, tripId }: { userId: string; tripId: string | null }) {
  const map = useMapApi();
  const trip = useQuery({
    queryKey: ['admin', 'trip', userId, tripId],
    queryFn: () => api<TripDetail>(`/api/admin/users/${userId}/trips/${tripId}`),
    enabled: !!tripId,
  });
  useEffect(() => {
    if (map.ready) map.setCoverageEnabled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.ready]);
  useEffect(() => {
    if (!trip.data || !tripId) {
      map.setTrack(null);
      map.setMarkers([]);
      return;
    }
    const line = trip.data.points.map((p) => [p.lon, p.lat] as LngLat);
    map.setTrack(line, line);
    if (line[0]) map.setMarkers([{ id: 's', lngLat: line[0], kind: 'start' }, { id: 'e', lngLat: line.at(-1)!, kind: 'end' }]);
    map.fitTo(line.length ? line : trip.data.geometry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.data, tripId, map.ready]);
  return <div className="admin-map" ref={map.attach} role="region" aria-label="User coverage and trips map" />;
}
