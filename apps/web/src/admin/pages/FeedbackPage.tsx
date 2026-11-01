import {
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_TYPE_LABEL,
  type FeedbackItem,
  type FeedbackStatus,
  FeedbackStatusSchema,
  type FeedbackType,
  FeedbackTypeSchema,
  type SpeedLimitReport,
} from '@wayfinder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Image, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api, errorMessage } from '../../lib/api';
import { useAppConfig } from '../../lib/config';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { useIsAdmin } from '../hooks';
import { PageHeader, QueryState, type StatusKind, StatusPill } from './common';

const STATUS_KIND: Record<FeedbackStatus, StatusKind> = { new: 'warn', planned: 'idle', in_progress: 'idle', done: 'ok', wont_fix: 'idle' };
const feedbackKey = ['admin', 'feedback'] as const;

export function FeedbackPage() {
  const { config } = useAppConfig();
  const [status, setStatus] = useState<FeedbackStatus | ''>('');
  const [type, setType] = useState<FeedbackType | ''>('');
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: [...feedbackKey, { status, type, q }],
    queryFn: () =>
      api<{ items: FeedbackItem[]; newCount: number }>('/api/admin/feedback', { query: { status: status || undefined, type: type || undefined, q: q || undefined } }),
  });
  return (
    <>
      <PageHeader
        title="Feedback"
        description={
          config.feedbackEnabled
            ? 'Bug reports and ideas from users. Opening a report is recorded in the audit log.'
            : 'Feedback is switched off (App settings), so no new reports arrive. Existing reports are kept.'
        }
      />
      <div className="toolbar">
        <label className="toolbar-search">
          <Search aria-hidden />
          <span className="visually-hidden">Search messages and emails</span>
          <input className="input" placeholder="Search messages and emails" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select className="select select-inline" value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus | '')} aria-label="Status">
          <option value="">Any status</option>
          {FeedbackStatusSchema.options.map((s) => (
            <option key={s} value={s}>{FEEDBACK_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className="select select-inline" value={type} onChange={(e) => setType(e.target.value as FeedbackType | '')} aria-label="Kind">
          <option value="">Any kind</option>
          {FeedbackTypeSchema.options.map((t) => (
            <option key={t} value={t}>{FEEDBACK_TYPE_LABEL[t]}</option>
          ))}
        </select>
      </div>
      <QueryState isLoading={list.isLoading} error={list.error} rows={6}>
        {list.data?.items.length === 0 ? (
          <p className="empty">{status || type || q ? 'No reports match.' : 'No feedback yet.'}</p>
        ) : (
          <div className="table-wrap">
            <table className="table feedback-table">
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Message</th>
                  <th scope="col" className="hide-sm">From</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((f) => (
                  <tr key={f.id}>
                    <td className="num">{formatRelative(f.createdAt)}</td>
                    <td>{FEEDBACK_TYPE_LABEL[f.type]}</td>
                    <td className="feedback-message-cell">
                      <Link to={`/admin/feedback/${f.id}`}>{f.message.length > 110 ? `${f.message.slice(0, 110)}…` : f.message}</Link>
                      {f.hasScreenshot && <Image aria-label="Has a screenshot" className="feedback-has-shot" />}
                    </td>
                    <td className="hide-sm">{f.user?.email ?? 'Deleted account'}</td>
                    <td><StatusPill kind={STATUS_KIND[f.status]}>{FEEDBACK_STATUS_LABEL[f.status]}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </>
  );
}

export function FeedbackDetailPage() {
  const { id = '' } = useParams();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const item = useQuery({ queryKey: [...feedbackKey, id], queryFn: () => api<FeedbackItem>(`/api/admin/feedback/${id}`) });
  const shot = useQuery({
    queryKey: [...feedbackKey, id, 'screenshot'],
    enabled: !!item.data?.hasScreenshot,
    queryFn: async () => URL.createObjectURL(await (await api<Response>(`/api/admin/feedback/${id}/screenshot`, { raw: true })).blob()),
    staleTime: Infinity,
  });
  useEffect(() => () => void (shot.data && URL.revokeObjectURL(shot.data)), [shot.data]);
  const [notes, setNotes] = useState('');
  useEffect(() => setNotes(item.data?.adminNotes ?? ''), [item.data?.adminNotes]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useMutation({
    mutationFn: (patch: { status?: FeedbackStatus; adminNotes?: string }) => api<FeedbackItem>(`/api/admin/feedback/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (f) => {
      qc.setQueryData([...feedbackKey, id], f);
      void qc.invalidateQueries({ queryKey: feedbackKey, refetchType: 'active' });
      void qc.invalidateQueries({ queryKey: ['admin', 'feedback-summary'] });
      toast('Saved');
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (confirm: string) => api(`/api/admin/feedback/${id}`, { method: 'DELETE', body: { confirm } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: feedbackKey });
      void qc.invalidateQueries({ queryKey: ['admin', 'feedback-summary'] });
      toast('Report deleted');
      navigate('/admin/feedback');
    },
  });

  const f = item.data;
  return (
    <>
      <Link to="/admin/feedback" className="back-link">
        <ArrowLeft aria-hidden /> All feedback
      </Link>
      <QueryState isLoading={item.isLoading} error={item.error}>
        {f && (
          <>
            <PageHeader
              title={f.type === 'bug' ? 'Bug report' : f.type === 'idea' ? 'Idea' : 'Feedback'}
              description={`From ${f.user?.email ?? 'a deleted account'} · ${formatDateTime(f.createdAt)}`}
              actions={
                isAdmin ? (
                  <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setConfirmDelete(true)}>
                    <Trash2 aria-hidden /> Delete
                  </button>
                ) : undefined
              }
            />
            <div className="feedback-detail">
              <section className="admin-section">
                <h2>Message</h2>
                <p className="feedback-message">{f.message}</p>
                {shot.data && (
                  <a href={shot.data} target="_blank" rel="noreferrer" className="feedback-screenshot">
                    <img src={shot.data} alt="Screenshot sent with the report" />
                  </a>
                )}
              </section>
              {f.speedLimit && <SpeedLimitDetail report={f.speedLimit} />}
              <section className="admin-section">
                <h2>Triage</h2>
                <label className="field">
                  <span className="field-label">Status</span>
                  <select
                    className="select"
                    value={f.status}
                    disabled={!isAdmin || update.isPending}
                    onChange={(e) => update.mutate({ status: e.target.value as FeedbackStatus })}
                  >
                    {FeedbackStatusSchema.options.map((s) => (
                      <option key={s} value={s}>{FEEDBACK_STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Notes (admins only; the user never sees these)</span>
                  <textarea className="input textarea" rows={4} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!isAdmin} />
                </label>
                {isAdmin ? (
                  <div>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={notes === f.adminNotes || update.isPending} onClick={() => update.mutate({ adminNotes: notes })}>
                      Save notes
                    </button>
                  </div>
                ) : (
                  <p className="field-hint">Only admins can change reports.</p>
                )}
                <h2>Context</h2>
                <dl className="kv-grid feedback-context">
                  <div><dt>Screen</dt><dd>{f.context.screen}</dd></div>
                  <div><dt>Platform</dt><dd>{f.context.platform === 'web' ? 'Web' : 'Android'} {f.context.appVersion}</dd></div>
                  <div className="feedback-device"><dt>Device</dt><dd>{f.context.device}</dd></div>
                  <div>
                    <dt>Map view</dt>
                    <dd>{f.context.mapView ? `${f.context.mapView.center[1].toFixed(4)}, ${f.context.mapView.center[0].toFixed(4)} · zoom ${f.context.mapView.zoom}` : 'Not shared'}</dd>
                  </div>
                  <div><dt>Updated</dt><dd>{formatRelative(f.updatedAt)}</dd></div>
                  {f.user && <div><dt>User</dt><dd><Link to={`/admin/users/${f.user.id}`}>{f.user.email}</Link></dd></div>}
                </dl>
              </section>
            </div>
          </>
        )}
      </QueryState>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this report?"
        body={<p>The report and its screenshot are removed for good.</p>}
        confirmLabel="Delete report"
        typeToConfirm="DELETE"
        danger
        busy={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onConfirm={(typed) => remove.mutate(typed)}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

/**
 * Where a wrong limit was reported, with the way to fix it: the map data is OpenStreetMap's, so the
 * fix goes there, and reaches everyone with the next map data refresh.
 */
function SpeedLimitDetail({ report }: { report: SpeedLimitReport }) {
  const [lon, lat] = report.location;
  const at = `19/${lat.toFixed(6)}/${lon.toFixed(6)}`;
  return (
    <section className="admin-section">
      <h2>Speed limit</h2>
      <dl className="kv-grid feedback-context">
        <div>
          <dt>Shown</dt>
          <dd>{report.shownKmh !== null ? `${report.shownKmh} km/h${report.estimated ? ' (estimated: no sign mapped)' : ''}` : 'None'}</dd>
        </div>
        {report.signedKmh !== undefined && <div><dt>On the sign</dt><dd>{report.signedKmh} km/h</dd></div>}
        <div><dt>Where</dt><dd>{`${lat.toFixed(5)}, ${lon.toFixed(5)}`}{report.headingDeg !== undefined ? ` · heading ${Math.round(report.headingDeg)}°` : ''}</dd></div>
      </dl>
      <p className="field-hint">
        Check the sign, then fix the road&rsquo;s <code>maxspeed</code> in OpenStreetMap. The change reaches routes with the next map data refresh.
      </p>
      <div className="route-option-actions">
        <a className="btn btn-secondary btn-sm" href={`https://www.openstreetmap.org/#map=${at}`} target="_blank" rel="noreferrer">View in OpenStreetMap</a>
        <a className="btn btn-secondary btn-sm" href={`https://www.openstreetmap.org/edit#map=${at}`} target="_blank" rel="noreferrer">Edit in OpenStreetMap</a>
      </div>
    </section>
  );
}
