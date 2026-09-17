import { Compass, Hexagon, History, Navigation, Repeat, TriangleAlert } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { AccountMenu } from '../components/AccountMenu';
import { useAppConfig } from '../lib/config';
import { usePickOnMap } from '../planner/usePlannerMap';
import { MapControls } from './MapControls';
import { useMapApi } from './MapProvider';

const TABS = [
  { to: '/directions', label: 'Directions', icon: Navigation },
  { to: '/loop', label: 'Round trip', icon: Repeat },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/coverage', label: 'Explored', icon: Hexagon },
  { to: '/trips', label: 'Trips', icon: History },
];

export function MapShell() {
  const map = useMapApi();
  const { config } = useAppConfig();
  const location = useLocation();
  usePickOnMap();
  const onSettings = location.pathname.startsWith('/settings');

  return (
    <div className="map-shell">
      <div className="map-canvas" ref={map.attach} role="region" aria-label="Map" />
      <aside className="panel" aria-label={`${config.appName} planner`}>
        <header className="panel-header">
          <span className="brand">
            <svg viewBox="0 0 32 32" aria-hidden className="brand-mark">
              <path d="M16 2 28.1 9v14L16 30 3.9 23V9z" fill="var(--accent)" />
              <path d="M16 9.5 22 13v7l-6 3.5-6-3.5v-7z" fill="var(--surface)" />
              <circle cx="16" cy="16.5" r="2.6" fill="var(--explore)" />
            </svg>
            <span className="brand-name">{onSettings ? 'Settings' : config.appName}</span>
          </span>
        </header>
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
          <TriangleAlert aria-hidden /> Map tiles haven’t been built on the server yet, so the base map is blank. Routes and search still work.
        </p>
      )}
      <MapControls showCoverageToggle={!location.pathname.startsWith('/coverage')} />
    </div>
  );
}
