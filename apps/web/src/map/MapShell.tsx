import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Compass,
  History,
  Navigation,
  Repeat,
  Route,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { AccountMenu } from '../components/AccountMenu';
import { type ChosenPlace, SearchField } from '../components/SearchField';
import { useAppConfig } from '../lib/config';
import { usePlanner } from '../planner/PlannerState';
import { usePickOnMap } from '../planner/usePlannerMap';
import { MapControls } from './MapControls';
import { useMapApi } from './MapProvider';

const TABS = [
  { to: '/directions', label: 'Directions', icon: Navigation },
  { to: '/loop', label: 'Round trip', icon: Repeat },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/coverage', label: 'Coverage', icon: Route },
  { to: '/trips', label: 'Trips', icon: History },
];

export function MapShell() {
  const map = useMapApi();
  const planner = usePlanner();
  const navigate = useNavigate();
  const { config, copy } = useAppConfig();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [place, setPlace] = useState<ChosenPlace | null>(null);
  usePickOnMap();
  const onSettings = location.pathname.startsWith('/settings');
  // Settings hides the tabs, so remember where to go back to (query string included, so a
  // planned trip is still there).
  const lastPlannerPath = useRef('/directions');
  useEffect(() => {
    if (!onSettings) lastPlannerPath.current = location.pathname + location.search;
  }, [onSettings, location.pathname, location.search]);
  // On Directions the start/destination fields are the search.
  const showSearch = !onSettings && !location.pathname.startsWith('/directions');

  useEffect(() => {
    map.setSearchPin(place && showSearch ? { lngLat: place.location, label: place.name } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, showSearch, map.ready]);

  const choose = (p: ChosenPlace | null) => {
    setPlace(p);
    if (p) map.flyTo(p.location, 15);
  };

  return (
    <div className="map-shell">
      <div className="map-canvas" ref={map.attach} role="region" aria-label="Map" />
      <aside
        className={`panel ${collapsed ? 'is-collapsed' : ''}`}
        aria-label={`${config.appName} planner`}
      >
        <button
          type="button"
          className="sheet-handle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span aria-hidden className="sheet-grip" />
          {collapsed ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
        </button>
        <header className="panel-header">
          {onSettings ? (
            <span className="brand">
              <button
                type="button"
                className="icon-btn panel-back"
                aria-label="Back to map"
                onClick={() => navigate(lastPlannerPath.current)}
              >
                <ArrowLeft aria-hidden />
              </button>
              <h1 className="brand-name">Settings</h1>
            </span>
          ) : (
            <span className="brand">
              <svg viewBox="0 0 32 32" aria-hidden className="brand-mark">
                <path d="M16 2 28.1 9v14L16 30 3.9 23V9z" fill="var(--accent)" />
                <path d="M16 9.5 22 13v7l-6 3.5-6-3.5v-7z" fill="var(--surface)" />
                <circle cx="16" cy="16.5" r="2.6" fill="var(--explore)" />
              </svg>
              <span className="brand-name">{config.appName}</span>
            </span>
          )}
        </header>
        {showSearch && (
          <div className="panel-search">
            <SearchField
              label="Search"
              placeholder={copy.searchPlaceholder}
              value={place}
              onChange={choose}
              near={map.center()}
            />
            {place && (
              <div className="place-card">
                <div className="place-body">
                  <span className="place-name">{place.name}</span>
                  {place.description && <span className="place-meta">{place.description}</span>}
                  {place.hours && <span className={`place-meta place-hours ${place.hours.openNow ? 'is-open' : ''}`}>{place.hours.label}</span>}
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    planner.setTo(place);
                    setPlace(null);
                    navigate('/directions');
                  }}
                >
                  <Navigation aria-hidden /> Directions
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Clear place"
                  onClick={() => setPlace(null)}
                >
                  <X />
                </button>
              </div>
            )}
          </div>
        )}
        {!onSettings && (
          <nav className="panel-tabs" aria-label="Planner">
            {TABS.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className="panel-tab">
                <Icon aria-hidden />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        )}
        <div className="panel-scroll">
          <Outlet />
        </div>
      </aside>
      <div className="map-topright">
        <AccountMenu />
      </div>
      {map.tilesAvailable === false && (
        <p className="map-banner" role="status">
          <TriangleAlert aria-hidden /> Map tiles haven’t been built on the server yet, so the base
          map is blank. Routes and search still work.
        </p>
      )}
      <MapControls showCoverageToggle={!location.pathname.startsWith('/coverage')} />
    </div>
  );
}
