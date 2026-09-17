import { useState } from 'react';
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format';
import { useErrors } from '../hooks';
import { PageHeader, QueryState } from './common';

export function ErrorsPage() {
  const [service, setService] = useState('');
  const errors = useErrors(service || undefined);
  return (
    <>
      <PageHeader
        title="Errors"
        description="Unexpected failures from the last 30 days, grouped by message. Coordinates and emails are scrubbed before storage."
        actions={
          <select className="select" value={service} onChange={(e) => setService(e.target.value)} aria-label="Service">
            <option value="">All services</option>
            <option value="api">API</option>
            <option value="worker">Worker</option>
          </select>
        }
      />
      <QueryState isLoading={errors.isLoading} error={errors.error}>
        {errors.data?.groups.length === 0 ? (
          <p className="empty">No errors recorded. Nice.</p>
        ) : (
          <ul className="error-groups">
            {errors.data?.groups.map((g) => (
              <li key={g.latest.id}>
                <details>
                  <summary>
                    <span className="error-count num" aria-label={`${g.count} occurrences`}>{formatNumber(g.count)}×</span>
                    <span className="error-msg">{g.message}</span>
                    <span className="error-meta">
                      <span className="badge">{g.service}</span> <span className="mono-ish">{g.source}</span> · last {formatRelative(g.lastSeen)}
                    </span>
                  </summary>
                  <div className="error-detail">
                    <p className="field-hint">
                      Latest {formatDateTime(g.latest.createdAt)}
                      {g.latest.requestId && <> · request <code>{g.latest.requestId}</code></>}
                      {g.latest.userId && <> · user <code>{g.latest.userId}</code></>}
                    </p>
                    {g.latest.stack && <pre className="stack">{g.latest.stack}</pre>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </>
  );
}
