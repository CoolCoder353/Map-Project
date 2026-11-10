/** Desktop Head Unit console commands (developer.android.com/training/cars/testing/dhu), written to its stdin. */

/** The car screen's size in `shot car` pictures (DHU_CONFIG's resolution). */
export const CAR_SCREEN = [800, 480] as const;
/** See [dhuCommand.tap]; `.harness/config.json` `carTapScale` overrides it for another head unit. */
export const CAR_TAP_SCALE = 1;

/** Car keys the harness may press. No call, end-call or phone keys: it never starts a call. */
export const CAR_KEYS = ['home', 'back', 'search', 'navigation'] as const;
export type CarKey = (typeof CAR_KEYS)[number];

export const dhuCommand = {
  screenshot: (path: string) => `screenshot ${path}`,
  /**
   * A tap at (x, y) in the `shot car` picture, on the console's grid [scale] times the picture's.
   * With the rotary controller on (DHU_CONFIG) the grid is the picture's own: measured 1:1 on DHU
   * 2.0 at 800×480 (R2-H2). Without it, a first run measured 1.16.
   */
  tap: (x: number, y: number, scale = CAR_TAP_SCALE) => `tap ${Math.round(x * scale)} ${Math.round(y * scale)}`,
  /** The car's own GPS. The DHU takes latitude first; accuracy 5 m, altitude 0. */
  location: (lon: number, lat: number, speedMps = 0, bearing = 0) => `location ${lat.toFixed(6)} ${lon.toFixed(6)} 5 0 ${speedMps.toFixed(1)} ${Math.round(bearing)}`,
  day: () => 'day',
  night: () => 'night',
  key: (key: CarKey) => `keycode ${key}`,
  restrict: (on: boolean) => `restrict ${on ? 'all' : 'none'}`,
  /**
   * The rotary controller: each turn moves the focus one item down (right) or up (left) a car
   * list, scrolling it. The console has no swipe, so this is how lists below the fold are reached (H17).
   */
  rotate: (down: boolean) => `dpad rotate ${down ? 'right' : 'left'}`,
  /**
   * Moves the rotary controller's focus up out of the rail (mic, layout, app icons), where it
   * starts, into the app's list, so [rotate] then moves along its rows (R2-H3).
   */
  focus: () => 'dpad up',
  /** Presses the item the rotary controller has focused. */
  select: () => 'dpad click',
  quit: () => 'quit',
};

/** An 800×480 touch head unit with a cluster, sending the car's location, speed and day/night. */
export const DHU_CONFIG = `[general]
touch = true
touchpad = false
controller = true
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
