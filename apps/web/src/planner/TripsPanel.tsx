import type { TripSummary } from '@wayfinder/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Car, ChevronRight, Footprints, History, Navigation } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { useAppConfig } from '../lib/config';
import { formatDate, formatDistanceShort, formatDuration, formatTime } from '../lib/format';

export function TripsPanel() {
  const { copy } = useAppConfig();
  const q = useInfiniteQuery({
    queryKey: ['trips'],
    queryFn: ({ pageParam }) =>
      api<{ items: TripSummary[]; nextCursor: string | null }>('/api/trips', { query: { limit: 30, cursor: pageParam ?? undefined } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const trips = q.data?.pages.flatMap((p) => p.items) ?? [];
  const groups = new Map<string, TripSummary[]>();
  for (const t of trips) {
    const key = formatDate(t.startedAt);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  return (
    <div className="panel-section">
      {q.isLoading && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 56 }} />)}
      {q.isError && <p className="notice notice-error">Couldn’t load trips.</p>}
      {!q.isLoading && trips.length === 0 && (
        <div className="empty">
          <History aria-hidden />
          <p>{copy.tripsEmpty}</p>
        </div>
      )}
      {[...groups].map(([day, items]) => (
        <section key={day} className="trip-group" aria-label={day}>
          <h2 className="panel-heading">{day}</h2>
          <ul className="trip-list">
            {items.map((t) => (
              <li key={t.id}>
                <Link to={`/trips/${t.id}`} className="trip-row">
                  <span className="place-icon" aria-hidden>
                    {t.mode === 'car' ? <Car /> : <Footprints />}
                  </span>
                  <span className="place-body">
                    <span className="place-name num">
                      {formatTime(t.startedAt)} · {formatDistanceShort(t.distanceM)}
                    </span>
                    <span className="place-meta num">
                      {t.mode === 'car' ? 'Drive' : 'Walk'}, {formatDuration((new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime()) / 1000)}
                      {t.source === 'navigation' && (
                        <span className="badge">
                          <Navigation aria-hidden /> Navigated
                        </span>
                      )}
                      {t.newCells > 0 && <span className="badge badge-new">{t.newCells} new hexagons</span>}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="trip-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {q.hasNextPage && (
        <button type="button" className="btn btn-secondary btn-block" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage ? 'Loading…' : 'Load older trips'}
        </button>
      )}
    </div>
  );
}
