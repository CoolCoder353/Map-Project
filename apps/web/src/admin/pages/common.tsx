import { CircleAlert, CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage } from '../../lib/api';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="admin-page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="admin-page-actions">{actions}</div>}
    </header>
  );
}

export function QueryState({ isLoading, error, children, rows = 3 }: { isLoading: boolean; error: unknown; children: ReactNode; rows?: number }) {
  if (isLoading)
    return (
      <div className="admin-skeletons" role="status" aria-label="Loading">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 44 }} />
        ))}
      </div>
    );
  if (error) return <p className="notice notice-error" role="alert">{errorMessage(error)}</p>;
  return <>{children}</>;
}

export type StatusKind = 'ok' | 'warn' | 'bad' | 'idle';

export function StatusPill({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  const Icon = kind === 'ok' ? CircleCheck : kind === 'warn' ? CircleAlert : kind === 'bad' ? CircleX : CircleDashed;
  const cls = kind === 'ok' ? 'badge-success' : kind === 'warn' ? 'badge-warning' : kind === 'bad' ? 'badge-danger' : '';
  return (
    <span className={`badge ${cls}`}>
      <Icon aria-hidden /> {children}
    </span>
  );
}
