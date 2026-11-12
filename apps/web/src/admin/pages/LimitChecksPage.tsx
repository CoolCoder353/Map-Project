import type { LimitCheck } from '@wayfinder/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PageHeader, QueryState } from './common';

/** What drives suggest about a road's limit, in a few words. */
export function limitVerdict(c: Pick<LimitCheck, 'limitKmh' | 'typicalKmh'>): string {
  return c.typicalKmh > c.limitKmh ? 'Drives go well over it: the limit may be too low' : 'Drives go well under it: the limit may be too high';
}

/**
 * Roads whose limit the group's drives suggest is wrong, from the nightly road speeds job: to look
 * at and, where the map is wrong, correct in OpenStreetMap so the next map refresh picks it up.
 */
export function LimitChecksPage() {
  const checks = useQuery({ queryKey: ['admin', 'limit-checks'], queryFn: () => api<{ items: LimitCheck[] }>('/api/admin/limit-checks') });
  const items = checks.data?.items ?? [];
  return (
    <>
      <PageHeader
        title="Limits to check"
        description="Roads where drives from at least two people typically go well over the speed limit the map shows, or well under it on a fast road. Updated each night. Check the signs, then fix the limit in OpenStreetMap if it’s wrong."
      />
      <QueryState isLoading={checks.isLoading} error={checks.error}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Map limit</th>
              <th scope="col">Drives typically</th>
              <th scope="col">What it suggests</th>
              <th scope="col">Drives</th>
              <th scope="col"><span className="visually-hidden">Links</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.wayId}>
                <td className="num">{c.limitKmh} km/h</td>
                <td className="num">{c.typicalKmh} km/h</td>
                <td>{limitVerdict(c)}</td>
                <td className="num">{c.trips} by {c.people} people</td>
                <td className="num-col">
                  <a className="btn btn-secondary btn-sm" href={`https://www.openstreetmap.org/way/${c.wayId}`} target="_blank" rel="noreferrer">View road</a>{' '}
                  <a className="btn btn-secondary btn-sm" href={`https://www.openstreetmap.org/edit?way=${c.wayId}`} target="_blank" rel="noreferrer">Edit in OpenStreetMap</a>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">No limits to check. Roads appear here once enough drives disagree with their limit.</td>
              </tr>
            )}
          </tbody>
        </table>
      </QueryState>
    </>
  );
}
