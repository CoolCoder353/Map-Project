/** Desktop Head Unit console commands (developer.android.com/training/cars/testing/dhu), written to its stdin. */

/** Car keys the harness may press. No call, end-call or phone keys: it never starts a call. */
export const CAR_KEYS = ['home', 'back', 'search', 'navigation'] as const;
export type CarKey = (typeof CAR_KEYS)[number];

export const dhuCommand = {
  screenshot: (path: string) => `screenshot ${path}`,
  tap: (x: number, y: number) => `tap ${Math.round(x)} ${Math.round(y)}`,
  /** The car's own GPS. The DHU takes latitude first; accuracy 5 m, altitude 0. */
  location: (lon: number, lat: number, speedMps = 0, bearing = 0) => `location ${lat.toFixed(6)} ${lon.toFixed(6)} 5 0 ${speedMps.toFixed(1)} ${Math.round(bearing)}`,
  day: () => 'day',
  night: () => 'night',
  key: (key: CarKey) => `keycode ${key}`,
  restrict: (on: boolean) => `restrict ${on ? 'all' : 'none'}`,
  quit: () => 'quit',
};

/** An 800×480 touch head unit with a cluster, sending the car's location, speed and day/night. */
export const DHU_CONFIG = `[general]
touch = true
resolution = 800x480
dpi = 160
framerate = 30
instrumentcluster = true

[sensors]
location = true
night_mode = true
driving_status = true
speed = true
compass = true
`;
