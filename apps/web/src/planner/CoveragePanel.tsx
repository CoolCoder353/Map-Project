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
      {s && s.cellsVisited === 0 && <p className="empty">{copy.coverageEmpty}</p>}
      {s && s.cellsVisited > 0 && (
        <dl className="stat-list">
          <div>
            <dt>Area explored</dt>
            <dd className="num">
              {formatNumber(Math.round(s.areaKm2 * 10) / 10)} <small>km²</small>
            </dd>
          </div>
          <div>
            <dt>Hexagons visited</dt>
            <dd className="num">{formatNumber(s.cellsVisited)}</dd>
          </div>
          <div>
            <dt>New this week</dt>
            <dd className="num">{formatNumber(s.newCellsWeek)}</dd>
          </div>
          <div>
            <dt>New this month</dt>
            <dd className="num">{formatNumber(s.newCellsMonth)}</dd>
          </div>
          <div>
            <dt>Reached driving</dt>
            <dd className="num">{formatNumber(s.byMode.car)}</dd>
          </div>
          <div>
            <dt>Reached walking</dt>
            <dd className="num">{formatNumber(s.byMode.foot)}</dd>
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
          <span className="legend-swatch legend-explored" aria-hidden /> Explored
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-fog" aria-hidden /> Not yet explored (shaded)
        </span>
        <span className="legend-item">
          <Layers aria-hidden /> Zoom in to see individual hexagons
        </span>
      </div>
    </div>
  );
}
