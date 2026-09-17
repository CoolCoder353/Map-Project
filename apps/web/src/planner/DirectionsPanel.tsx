import type { ExploreRouteResponse, PlannedRoute, Route } from '@wayfinder/shared';
import { ArrowDownUp, Info, Route as RouteIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ChosenPlace } from '../components/SearchField';
import { ModeToggle } from '../components/ModeToggle';
import { SearchField } from '../components/SearchField';
import { api, errorMessage } from '../lib/api';
import { useAppConfig } from '../lib/config';
import { useToast } from '../lib/toast';
import { type MapMarker, useMapApi } from '../map/MapProvider';
import { usePlanner } from './PlannerState';
import { RouteOption } from './RouteOption';
import { useOverlayCleanup } from './usePlannerMap';

export function DirectionsPanel() {
  const planner = usePlanner();
  const { from, to, mode, budgetMin, routes, selectedRouteId } = planner;
  const map = useMapApi();
  const { copy } = useAppConfig();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  useOverlayCleanup();
  const [params, setParams] = useSearchParams();

  // Keep the trip in the URL so a reload or a shared link reopens it.
  useEffect(() => {
    const read = (key: string): ChosenPlace | null => {
      const raw = params.get(key);
      const m = raw?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(.*))?$/);
      return m ? { name: m[3] || 'Dropped pin', description: '', location: [Number(m[1]), Number(m[2])] } : null;
    };
    if (!from && params.get('from')) planner.setFrom(read('from'));
    if (!to && params.get('to')) planner.setTo(read('to'));
    const m = params.get('mode');
    if (m === 'car' || m === 'foot') planner.setMode(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const enc = (p: ChosenPlace | null) => (p ? `${p.location[0].toFixed(5)},${p.location[1].toFixed(5)},${p.name}` : null);
    const next = new URLSearchParams();
    if (from) next.set('from', enc(from)!);
    if (to) next.set('to', enc(to)!);
    if (from || to) next.set('mode', mode);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, mode]);

  // Fetch whenever both ends, mode or budget change.
  useEffect(() => {
    if (!from || !to) {
      planner.setRoutes(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await api<ExploreRouteResponse>('/api/routes/explore', {
          method: 'POST',
          body: { from: from.location, to: to.location, mode, budgetMin },
          signal: ctrl.signal,
        });
        planner.setRoutes(res);
        planner.setSelectedRouteId(res.fastest.id);
        map.fitTo([...res.fastest.geometry, ...res.explore.flatMap((r) => r.geometry)]);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        planner.setRoutes(null);
        setError(errorMessage(err));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, mode, budgetMin]);

  const all: Route[] = routes ? [routes.fastest, ...routes.explore] : [];

  useEffect(() => {
    map.setRoutes(all, selectedRouteId, hovered);
    const markers: MapMarker[] = [];
    if (from) markers.push({ id: 'from', lngLat: from.location, kind: 'start', label: from.name });
    if (to) markers.push({ id: 'to', lngLat: to.location, kind: 'end', label: to.name });
    map.setMarkers(markers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, selectedRouteId, hovered, from, to, map.ready]);

  useEffect(() => map.onRouteClick((id) => planner.setSelectedRouteId(id)), [map, planner]);
  useEffect(() => map.onRouteHover(setHovered), [map]);

  useEffect(() => {
    if (!from && !to) return;
    if (from && !to) map.flyTo(from.location, 14);
    if (to && !from) map.flyTo(to.location, 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const send = async (route: Route) => {
    setSending(route.id);
    try {
      await api<PlannedRoute>('/api/planned-routes', {
        method: 'POST',
        body: { name: `${route.kind === 'fastest' ? 'Fastest' : 'Explore'} to ${to?.name ?? 'destination'}`, route },
      });
      toast(copy.sentToPhone);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setSending(null);
    }
  };

  const fastestIsNew = routes && routes.fastest.novelty.noveltyPct >= 90;

  return (
    <div className="panel-section">
      <div className="directions-fields">
        <div className="directions-inputs">
          <SearchField
            label="Starting point"
            placeholder="Choose starting point"
            icon="start"
            value={from}
            onChange={planner.setFrom}
            near={to?.location ?? map.center()}
            allowCurrentLocation
            onPickOnMap={() => planner.setPickTarget('from')}
          />
          <SearchField
            label="Destination"
            placeholder="Choose destination"
            icon="end"
            value={to}
            onChange={planner.setTo}
            near={from?.location ?? map.center()}
            onPickOnMap={() => planner.setPickTarget('to')}
            autoFocus={!to}
          />
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Swap start and destination"
          onClick={() => {
            planner.setFrom(to);
            planner.setTo(from);
          }}
        >
          <ArrowDownUp />
        </button>
      </div>
      {planner.pickTarget && (planner.pickTarget === 'from' || planner.pickTarget === 'to') && (
        <p className="notice" role="status">
          <Info aria-hidden /> Click the map to set the {planner.pickTarget === 'from' ? 'starting point' : 'destination'}.
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => planner.setPickTarget(null)}>
            Cancel
          </button>
        </p>
      )}

      <div className="directions-controls">
        <ModeToggle value={mode} onChange={planner.setMode} />
        <div className="budget">
          <label htmlFor="budget" className="budget-label">
            {copy.budgetLabel(budgetMin)}
          </label>
          <input
            id="budget"
            className="range"
            type="range"
            min={5}
            max={60}
            step={5}
            value={budgetMin}
            onChange={(e) => planner.setBudgetMin(Number(e.target.value))}
          />
        </div>
      </div>

      {error && (
        <p className="notice notice-error" role="alert">
          <Info aria-hidden /> {error}
        </p>
      )}

      {loading && (
        <div className="route-skeletons" aria-label="Finding routes" role="status">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 64 }} />
          ))}
        </div>
      )}

      {!loading && routes && (
        <>
          <ul className="route-list" aria-label="Fastest route">
            <RouteOption
              route={routes.fastest}
              title="Fastest"
              selected={selectedRouteId === routes.fastest.id}
              hovered={hovered === routes.fastest.id}
              onHover={(h) => setHovered(h ? routes.fastest.id : null)}
              onSelect={() => planner.setSelectedRouteId(routes.fastest.id)}
              onSend={() => void send(routes.fastest)}
              sending={sending === routes.fastest.id}
            />
          </ul>
          <h2 className="panel-heading">{copy.exploreHeading}</h2>
          {routes.explore.length > 0 ? (
            <ul className="route-list" aria-label={copy.exploreHeading}>
              {routes.explore.map((r, i) => (
                <RouteOption
                  key={r.id}
                  route={r}
                  title={`Explore ${i + 1}`}
                  selected={selectedRouteId === r.id}
                  hovered={hovered === r.id}
                  onHover={(h) => setHovered(h ? r.id : null)}
                  onSelect={() => planner.setSelectedRouteId(r.id)}
                  onSend={() => void send(r)}
                  sending={sending === r.id}
                />
              ))}
            </ul>
          ) : (
            <p className="empty">
              {fastestIsNew
                ? copy.allNewAlready
                : `No explore routes fit within ${budgetMin} extra minutes. Try a bigger budget.`}
            </p>
          )}
        </>
      )}

      {!loading && !routes && !error && (
        <div className="empty">
          <RouteIcon aria-hidden />
          <p>Choose where you’re going to compare the fastest route with ways you haven’t been.</p>
        </div>
      )}
    </div>
  );
}
