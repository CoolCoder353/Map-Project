import type { PlannedRoute, PublicUser, UserSettings } from '@wayfinder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, LogOut, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ModeToggle } from '../components/ModeToggle';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatDistanceShort, formatDuration } from '../lib/format';
import { useToast } from '../lib/toast';

export function SettingsPanel() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const planned = useQuery({ queryKey: ['planned-routes'], queryFn: () => api<{ items: PlannedRoute[] }>('/api/planned-routes') });

  const save = useMutation({
    mutationFn: (patch: Partial<UserSettings>) => api<PublicUser>('/api/me/settings', { method: 'PATCH', body: patch }),
    onSuccess: (u) => setUser(u),
    onError: (err) => toast(errorMessage(err)),
  });
  const removePlanned = useMutation({
    mutationFn: (id: string) => api(`/api/planned-routes/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['planned-routes'] }),
  });
  const deleteAccount = useMutation({
    mutationFn: (confirm: string) => api('/api/me', { method: 'DELETE', body: { confirm } }),
    onSuccess: () => void logout(),
    onError: (err) => setDeleteError(errorMessage(err)),
  });

  const exportData = async () => {
    setExporting(true);
    try {
      const res = await api<Response>('/api/me/export', { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wayfinder-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  if (!user) return null;
  const s = user.settings;
  return (
    <div className="panel-section settings">
      <section aria-labelledby="set-account">
        <h2 id="set-account" className="panel-heading">Account</h2>
        <p className="settings-row">
          <span>{user.email}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
            <LogOut aria-hidden /> Sign out
          </button>
        </p>
      </section>

      <section aria-labelledby="set-routes">
        <h2 id="set-routes" className="panel-heading">Route defaults</h2>
        <div className="settings-row">
          <span>Default travel mode</span>
          <ModeToggle value={s.defaultMode} onChange={(m) => save.mutate({ defaultMode: m })} label="Default travel mode" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="set-budget">
            Extra time for explore routes: {s.exploreBudgetMin} min
          </label>
          <input id="set-budget" className="range" type="range" min={5} max={60} step={5} defaultValue={s.exploreBudgetMin} onPointerUp={(e) => save.mutate({ exploreBudgetMin: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => save.mutate({ exploreBudgetMin: Number((e.target as HTMLInputElement).value) })} />
        </div>
      </section>

      <section aria-labelledby="set-tracking">
        <h2 id="set-tracking" className="panel-heading">Location history</h2>
        <label className="settings-row">
          <span>
            Background tracking
            <span className="field-hint" style={{ display: 'block' }}>
              Records where you go on your Android phone, even when you’re not navigating. Takes effect next time the app syncs.
            </span>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={s.trackingEnabled} onChange={(e) => save.mutate({ trackingEnabled: e.target.checked })} />
        </label>
        <div className="settings-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportData()} disabled={exporting}>
            {exporting ? <span className="spinner" aria-hidden /> : <Download aria-hidden />} Download my data
          </button>
        </div>
      </section>

      <section aria-labelledby="set-planned">
        <h2 id="set-planned" className="panel-heading">Planned routes</h2>
        <p className="field-hint">Routes you’ve sent to your phone.</p>
        {planned.data?.items.length === 0 && <p className="empty">Nothing planned yet.</p>}
        <ul className="trip-list">
          {planned.data?.items.map((p) => (
            <li key={p.id} className="trip-row">
              <span className="place-body">
                <span className="place-name">{p.name}</span>
                <span className="place-meta num">
                  {formatDistanceShort(p.route.distanceM)} · {formatDuration(p.route.durationS)} · saved {formatDate(p.createdAt)}
                </span>
              </span>
              <button type="button" className="icon-btn" aria-label={`Remove ${p.name}`} onClick={() => removePlanned.mutate(p.id)}>
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="set-danger">
        <h2 id="set-danger" className="panel-heading">Delete account</h2>
        <p className="field-hint">Deletes your account, trips and coverage. Recoverable for 7 days, then permanent.</p>
        <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setConfirmDelete(true)}>
          <Trash2 aria-hidden /> Delete my account
        </button>
      </section>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete your account?"
        body={<p>You’ll be signed out everywhere. Your trips, coverage and planned routes are removed permanently after 7 days.</p>}
        confirmLabel="Delete account"
        typeToConfirm={user.email}
        danger
        busy={deleteAccount.isPending}
        error={deleteError}
        onConfirm={(typed) => deleteAccount.mutate(typed)}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
