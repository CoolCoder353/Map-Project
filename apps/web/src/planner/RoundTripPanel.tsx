import type { PlannedRoute, Route, RoundTripResponse } from '@wayfinder/shared';
import { Info, Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModeToggle } from '../components/ModeToggle';
import { SearchField } from '../components/SearchField';
import { api, errorMessage } from '../lib/api';
import { useAppConfig } from '../lib/config';
import { formatDuration } from '../lib/format';
import { useToast } from '../lib/toast';
import { useMapApi } from '../map/MapProvider';
import { usePlanner } from './PlannerState';
import { RouteOption } from './RouteOption';
import { useOverlayCleanup } from './usePlannerMap';

export function RoundTripPanel() {
  const planner = usePlanner();
  const { loopStart, loopMinutes, loops, selectedLoopId, mode } = planner;
  const map = useMapApi();
  const { copy } = useAppConfig();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  useOverlayCleanup();

  useEffect(() => {
    map.setRoutes(loops ?? [], selectedLoopId, hovered);
    map.setMarkers(loopStart ? [{ id: 'start', lngLat: loopStart.location, kind: 'start', label: loopStart.name }] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loops, selectedLoopId, hovered, loopStart, map.ready]);
  useEffect(() => map.onRouteClick((id) => planner.setSelectedLoopId(id)), [map, planner]);
  useEffect(() => map.onRouteHover(setHovered), [map]);

  const generate = async () => {
    if (!loopStart) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<RoundTripResponse>('/api/routes/roundtrip', {
        method: 'POST',
        body: { start: loopStart.location, mode, targetMin: loopMinutes },
      });
      planner.setLoops(res.routes);
      planner.setSelectedLoopId(res.routes[0]?.id ?? null);
      if (res.routes.length) map.fitTo(res.routes.flatMap((r) => r.geometry));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const send = async (route: Route) => {
    setSending(route.id);
    try {
      await api<PlannedRoute>('/api/planned-routes', {
        method: 'POST',
        body: { name: `${formatDuration(route.durationS)} loop from ${loopStart?.name ?? 'start'}`, route },
      });
      toast(copy.sentToPhone);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="panel-section">
      <p className="panel-intro">{copy.roundTripIntro}</p>
      <SearchField
        label="Start"
        placeholder="Where does the loop start?"
        icon="start"
        value={loopStart}
        onChange={planner.setLoopStart}
        near={map.center()}
        allowCurrentLocation
        onPickOnMap={() => planner.setPickTarget('loopStart')}
      />
      {planner.pickTarget === 'loopStart' && (
        <p className="notice" role="status">
          <Info aria-hidden /> Click the map to set the start.
        </p>
      )}
      <div className="directions-controls">
        <ModeToggle value={mode} onChange={planner.setMode} />
        <div className="budget">
          <label htmlFor="loop-minutes" className="budget-label">
            About {formatDuration(loopMinutes * 60)}
          </label>
          <input
            id="loop-minutes"
            className="range"
            type="range"
            min={15}
            max={mode === 'car' ? 300 : 360}
            step={15}
            value={loopMinutes}
            onChange={(e) => planner.setLoopMinutes(Number(e.target.value))}
          />
        </div>
      </div>
      <button type="button" className="btn btn-primary btn-block" disabled={!loopStart || loading} onClick={() => void generate()}>
        {loading ? <span className="spinner" aria-hidden /> : <Repeat aria-hidden />}
        {loops ? 'Make new loops' : 'Make loops'}
      </button>
      {error && (
        <p className="notice notice-error" role="alert">
          <Info aria-hidden /> {error}
        </p>
      )}
      {loops && !loading && (
        loops.length ? (
          <ul className="route-list" aria-label="Loops">
            {loops.map((r, i) => (
              <RouteOption
                key={r.id}
                route={r}
                title={`Loop ${i + 1}`}
                selected={selectedLoopId === r.id}
                hovered={hovered === r.id}
                onHover={(h) => setHovered(h ? r.id : null)}
                onSelect={() => planner.setSelectedLoopId(r.id)}
                onSend={() => void send(r)}
                sending={sending === r.id}
              />
            ))}
          </ul>
        ) : (
          <p className="empty">{copy.noRoundTrips}</p>
        )
      )}
    </div>
  );
}
