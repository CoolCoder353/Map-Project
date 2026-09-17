import type { LngLat, Mode, TripDetail } from '@wayfinder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pause, Play, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, formatDistanceShort, formatDuration, formatTime } from '../lib/format';
import { useToast } from '../lib/toast';
import { useMapApi } from '../map/MapProvider';
import { useOverlayCleanup } from './usePlannerMap';

export function TripDetailPanel() {
  const { id = '' } = useParams();
  const map = useMapApi();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const trip = useQuery({ queryKey: ['trip', id], queryFn: () => api<TripDetail>(`/api/trips/${id}`) });
  const [position, setPosition] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useOverlayCleanup();

  const points = useMemo(() => trip.data?.points ?? [], [trip.data]);
  const t0 = points[0]?.ts ?? 0;
  const t1 = points.at(-1)?.ts ?? 0;
  const currentTs = t0 + (t1 - t0) * position;
  const index = useMemo(() => {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (points[mid]!.ts <= currentTs) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }, [points, currentTs]);

  useEffect(() => {
    if (!trip.data) return;
    const line = trip.data.points.map((p) => [p.lon, p.lat] as LngLat);
    map.setTrack(line.length > 1 ? line : trip.data.geometry, line.slice(0, index + 1));
    const here = points[index];
    map.setMarkers([
      ...(line[0] ? [{ id: 'start', lngLat: line[0], kind: 'start' as const }] : []),
      ...(here ? [{ id: 'pos', lngLat: [here.lon, here.lat] as LngLat, kind: 'position' as const }] : []),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.data, index, map.ready]);

  useEffect(() => {
    if (trip.data) map.fitTo(trip.data.geometry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.data?.id]);

  // Replay at ~15 updates/s. Per-frame state updates would starve router transitions, so
  // navigating away mid-replay would change the URL without re-rendering.
  useEffect(() => {
    if (!playing) return;
    const durationMs = 12_000; // whole trip replays in 12 s
    const stepMs = 66;
    const timer = setInterval(() => {
      setPosition((p) => {
        const next = Math.min(1, p + stepMs / durationMs);
        if (next >= 1) setPlaying(false);
        return next;
      });
    }, stepMs);
    return () => clearInterval(timer);
  }, [playing]);

  const updateMode = useMutation({
    mutationFn: (mode: Mode) => api(`/api/trips/${id}`, { method: 'PATCH', body: { mode } }),
    onSuccess: () => {
      toast('Mode updated. Your coverage will refresh shortly.');
      void qc.invalidateQueries({ queryKey: ['trip', id] });
      void qc.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/trips/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Trip deleted. Its hexagons are being removed from your coverage.');
      void qc.invalidateQueries({ queryKey: ['trips'] });
      void qc.invalidateQueries({ queryKey: ['coverage-stats'] });
      navigate('/trips');
    },
  });

  const t = trip.data;
  return (
    <div className="panel-section">
      <Link to="/trips" className="back-link" onClick={() => setPlaying(false)}>
        <ArrowLeft aria-hidden /> All trips
      </Link>
      {trip.isLoading && <div className="skeleton" style={{ height: 160 }} />}
      {trip.isError && <p className="notice notice-error">{errorMessage(trip.error)}</p>}
      {t && (
        <>
          <div>
            <h2 className="panel-title">{t.mode === 'car' ? 'Drive' : 'Walk'} · {formatDistanceShort(t.distanceM)}</h2>
            <p className="field-hint num">
              {formatDateTime(t.startedAt)} – {formatTime(t.endedAt)} ({formatDuration((new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime()) / 1000)})
            </p>
          </div>
          {t.newCells > 0 && <p><span className="badge badge-new">{t.newCells} hexagons you’d never been to before</span></p>}

          <div className="replay">
            <button type="button" className="icon-btn replay-play" aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => {
              if (position >= 1) setPosition(0);
              setPlaying((p) => !p);
            }}>
              {playing ? <Pause /> : <Play />}
            </button>
            <input
              className="range"
              type="range"
              min={0}
              max={1000}
              value={Math.round(position * 1000)}
              aria-label="Replay position"
              aria-valuetext={points[index] ? formatTime(points[index]!.ts) : undefined}
              onChange={(e) => {
                setPlaying(false);
                setPosition(Number(e.target.value) / 1000);
              }}
            />
            <span className="num replay-time">{points[index] ? formatTime(points[index]!.ts) : '–'}</span>
          </div>

          <div className="field">
            <span className="field-label" id="trip-mode-label">Recorded as</span>
            <div className="segmented" role="radiogroup" aria-labelledby="trip-mode-label">
              {(['car', 'foot'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={t.mode === m} disabled={updateMode.isPending} onClick={() => t.mode !== m && updateMode.mutate(m)}>
                  {m === 'car' ? 'Drive' : 'Walk'}
                </button>
              ))}
            </div>
            <span className="field-hint">Change this if the trip was detected with the wrong mode.</span>
          </div>

          <button
            type="button"
            className="btn btn-danger-outline"
            onClick={() => {
              setPlaying(false);
              setConfirmDelete(true);
            }}
          >
            <Trash2 aria-hidden /> Delete trip
          </button>
          <ConfirmDialog
            open={confirmDelete}
            title="Delete this trip?"
            body={<p>The trip and its GPS points will be removed, and hexagons only this trip reached leave your coverage. It can be recovered for 7 days by an admin, then it’s gone for good.</p>}
            confirmLabel="Delete trip"
            danger
            busy={remove.isPending}
            error={remove.error ? errorMessage(remove.error) : null}
            onConfirm={() => remove.mutate()}
            onCancel={() => setConfirmDelete(false)}
          />
        </>
      )}
    </div>
  );
}
