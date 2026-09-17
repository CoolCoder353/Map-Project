import { POI_CATEGORIES, type DiscoverItem, type PoiCategory } from '@wayfinder/shared';
import { Binoculars, Coffee, Compass, Info, Landmark, Mountain, Navigation, Palmtree, Sparkles, Trees, Umbrella, Waves } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ModeToggle } from '../components/ModeToggle';
import { SearchField } from '../components/SearchField';
import { api, errorMessage } from '../lib/api';
import { useAppConfig } from '../lib/config';
import { formatDistanceShort } from '../lib/format';
import { useMapApi } from '../map/MapProvider';
import { usePlanner } from './PlannerState';
import { useOverlayCleanup } from './usePlannerMap';
import { useEffect } from 'react';

const CATEGORY: Record<PoiCategory, { label: string; icon: typeof Mountain }> = {
  viewpoint: { label: 'Lookouts', icon: Binoculars },
  peak: { label: 'Peaks', icon: Mountain },
  waterfall: { label: 'Waterfalls', icon: Waves },
  park: { label: 'Parks', icon: Trees },
  beach: { label: 'Beaches', icon: Umbrella },
  attraction: { label: 'Attractions', icon: Sparkles },
  cafe: { label: 'Cafés', icon: Coffee },
  historic: { label: 'Historic', icon: Landmark },
  trailhead: { label: 'Trailheads', icon: Compass },
  museum: { label: 'Museums', icon: Landmark },
  picnic: { label: 'Picnic spots', icon: Palmtree },
};

export function DiscoverPanel() {
  const planner = usePlanner();
  const { discoverOrigin, discoverItems, mode } = planner;
  const map = useMapApi();
  const navigate = useNavigate();
  const { copy } = useAppConfig();
  const [minutes, setMinutes] = useState(30);
  const [categories, setCategories] = useState<PoiCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  useOverlayCleanup();

  useEffect(() => {
    map.setMarkers([
      ...(discoverOrigin ? [{ id: 'origin', lngLat: discoverOrigin.location, kind: 'start' as const }] : []),
      ...(discoverItems ?? []).map((i) => ({
        id: i.id,
        lngLat: i.location,
        kind: 'poi' as const,
        ...(focused === i.id || (discoverItems?.length ?? 0) <= 8 ? { label: i.name } : {}),
      })),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverItems, discoverOrigin, focused, map.ready]);

  const search = async () => {
    const origin = discoverOrigin?.location ?? map.center();
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ items: DiscoverItem[] }>('/api/discover', {
        query: { lon: origin[0], lat: origin[1], mode, maxMinutes: minutes, categories: categories.join(',') || undefined, limit: 25 },
      });
      planner.setDiscoverItems(res.items);
      if (res.items.length) map.fitTo([origin, ...res.items.map((i) => i.location)]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (c: PoiCategory) => setCategories((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  return (
    <div className="panel-section">
      <p className="panel-intro">{copy.discoverIntro}</p>
      <SearchField
        label="Search from"
        placeholder="From the middle of the map"
        icon="start"
        value={discoverOrigin}
        onChange={planner.setDiscoverOrigin}
        near={map.center()}
        allowCurrentLocation
        onPickOnMap={() => planner.setPickTarget('discoverOrigin')}
      />
      <div className="directions-controls">
        <ModeToggle value={mode} onChange={planner.setMode} />
        <div className="budget">
          <label htmlFor="discover-minutes" className="budget-label">
            Within {minutes} min
          </label>
          <input id="discover-minutes" className="range" type="range" min={5} max={180} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </div>
      </div>
      <div className="chips" role="group" aria-label="Categories">
        {POI_CATEGORIES.map((c) => {
          const { label, icon: Icon } = CATEGORY[c];
          return (
            <button key={c} type="button" className="chip" aria-pressed={categories.includes(c)} onClick={() => toggle(c)}>
              <Icon aria-hidden /> {label}
            </button>
          );
        })}
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={() => void search()} disabled={loading}>
        {loading ? <span className="spinner" aria-hidden /> : <Compass aria-hidden />} Find places
      </button>
      {error && (
        <p className="notice notice-error" role="alert">
          <Info aria-hidden /> {error}
        </p>
      )}
      {discoverItems && !loading && (
        discoverItems.length === 0 ? (
          <p className="empty">{copy.discoverEmpty}</p>
        ) : (
          <ul className="place-list">
            {discoverItems.map((item) => {
              const { icon: Icon, label } = CATEGORY[item.category];
              return (
                <li key={item.id} onMouseEnter={() => setFocused(item.id)} onMouseLeave={() => setFocused(null)}>
                  <button type="button" className="place-row" onClick={() => map.flyTo(item.location, 15)}>
                    <span className="place-icon" aria-hidden>
                      <Icon />
                    </span>
                    <span className="place-body">
                      <span className="place-name">{item.name}</span>
                      <span className="place-meta num">
                        {label.replace(/s$/, '')} · {formatDistanceShort(item.distanceM)} away
                        {item.areaUnexploredPct >= 50 && <span className="badge badge-new">{item.areaUnexploredPct}% unexplored area</span>}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Directions to ${item.name}`}
                    onClick={() => {
                      planner.setTo({ name: item.name, description: label, location: item.location });
                      if (discoverOrigin) planner.setFrom(discoverOrigin);
                      navigate('/directions');
                    }}
                  >
                    <Navigation />
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}
