import { LocateFixed, Minus, Plus, Route } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../lib/api';
import { currentPosition } from '../lib/geolocation';
import { useToast } from '../lib/toast';
import { useMapApi } from './MapProvider';

export function MapControls({ showCoverageToggle }: { showCoverageToggle: boolean }) {
  const map = useMapApi();
  const toast = useToast();
  const [locating, setLocating] = useState(false);
  return (
    <div className="map-controls">
      {showCoverageToggle && (
        <button
          type="button"
          className="map-control"
          aria-pressed={map.coverageEnabled}
          aria-label={map.coverageEnabled ? 'Hide explored areas' : 'Show explored areas'}
          title="Explored areas"
          onClick={() => map.setCoverageEnabled(!map.coverageEnabled)}
        >
          <Route />
        </button>
      )}
      <button
        type="button"
        className="map-control"
        aria-label="Show my location"
        title="My location"
        disabled={locating}
        onClick={async () => {
          setLocating(true);
          try {
            map.flyTo(await currentPosition(), 15);
          } catch (err) {
            toast(errorMessage(err));
          } finally {
            setLocating(false);
          }
        }}
      >
        {locating ? <span className="spinner" aria-hidden /> : <LocateFixed />}
      </button>
      <div className="map-control-group">
        <button type="button" className="map-control" aria-label="Zoom in" onClick={() => map.zoomBy(1)}>
          <Plus />
        </button>
        <button type="button" className="map-control" aria-label="Zoom out" onClick={() => map.zoomBy(-1)}>
          <Minus />
        </button>
      </div>
    </div>
  );
}
