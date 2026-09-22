import type { CoverageStats } from '@wayfinder/shared';
import { useQuery } from '@tanstack/react-query';
import { Info, Layers } from 'lucide-react';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAppConfig } from '../lib/config';
import { formatDate, formatNumber } from '../lib/format';
import { useMapApi } from '../map/MapProvider';

export function CoveragePanel() {
  const map = useMapApi();
  const { user } = useAuth();
  const { copy } = useAppConfig();
  const stats = useQuery({ queryKey: ['coverage-stats'], queryFn: () => api<CoverageStats>('/api/coverage/stats') });

  useEffect(() => {
    map.setCoverageEnabled(true);
    return () => map.setCoverageEnabled(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = stats.data;
  return (
    <div className="panel-section">
      <p className="panel-intro">{copy.coverageIntro}</p>
      {!user?.settings.trackingEnabled && (
        <p className="notice">
          <Info aria-hidden /> {copy.trackingOffHint}
        </p>
      )}
      {stats.isLoading && <div className="skeleton" style={{ height: 180 }} />}
      {stats.isError && <p className="notice notice-error">Couldn’t load your stats. {String((stats.error as Error).message)}</p>}
      {s && s.roadsTravelled === 0 && <p className="empty">{copy.coverageEmpty}</p>}
      {s && s.roadsTravelled > 0 && (
        <div className="coverage-lead">
          <p className="coverage-lead-value num">
            {formatNumber(s.roadKm)} <small>km of road travelled</small>
          </p>
          {s.newRoadsWeek > 0 && (
            <p className="coverage-lead-delta">
              <span className="badge badge-new">+{formatNumber(s.newRoadsWeek)} new roads this week</span>
            </p>
          )}
        </div>
      )}
      {s && s.roadsTravelled > 0 && (
        <dl className="stat-list">
          <div>
            <dt>Roads travelled</dt>
            <dd className="num">{formatNumber(s.roadsTravelled)}</dd>
          </div>
          <div>
            <dt>New this month</dt>
            <dd className="num">{formatNumber(s.newRoadsMonth)}</dd>
          </div>
          <div>
            <dt>Driven</dt>
            <dd className="num">{formatNumber(s.byMode.carKm)} km</dd>
          </div>
          <div>
            <dt>Walked</dt>
            <dd className="num">{formatNumber(s.byMode.footKm)} km</dd>
          </div>
          <div>
            <dt>Trips</dt>
            <dd className="num">{formatNumber(s.tripCount)}</dd>
          </div>
          <div>
            <dt>Distance recorded</dt>
            <dd className="num">
              {formatNumber(s.distanceKm)} <small>km</small>
            </dd>
          </div>
        </dl>
      )}
      {s?.firstVisitAt && <p className="field-hint">Exploring since {formatDate(s.firstVisitAt)}.</p>}
      <div className="legend" aria-label="Map legend">
        <span className="legend-item">
          <span className="legend-swatch legend-explored" aria-hidden /> Roads you’ve travelled
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-recent" aria-hidden /> First travelled this week
        </span>
        <span className="legend-item">
          <Layers aria-hidden /> Zoom in to see individual streets
        </span>
      </div>
    </div>
  );
}
