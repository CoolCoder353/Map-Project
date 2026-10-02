/**
 * Window sizes: every screen at a phone, 600 dp and 1000 dp window (Android's compact, medium and
 * expanded classes), and state kept when the window changes size (rotation, folding, multi-window).
 * The window is faked with `windowSize` / `resizeWindow` in fakes.tsx.
 */
/// <reference types="jest" />
import { act, fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Coverage from '../app/(tabs)/coverage';
import Discover from '../app/(tabs)/discover';
import Plan from '../app/(tabs)/plan';
import Navigate from '../app/navigate';
import Register from '../app/register';
import SignIn from '../app/sign-in';
import Trip from '../app/trip/[id]';
import { FORM_MAX_WIDTH, PANEL_WIDTH, layoutFor } from '../src/lib/layout';
import { WINDOWS, coverageStats, fake, renderScreen, resetFakes, resizeWindow, route, tripDetail, windowSize } from './fakes';

jest.mock('expo-router', () => require('./fakes').routerModule);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('../src/lib/session', () => require('./fakes').sessionModule);
jest.mock('../src/lib/appConfig', () => require('./fakes').appConfigModule);
jest.mock('../src/map/MapCanvas', () => require('./fakes').mapCanvasModule);
jest.mock('../src/lib/contacts', () => ({ findContacts: async () => [] }));
jest.mock('../src/lib/useApproxLocation', () => ({ useApproxLocation: () => undefined }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
jest.mock('../src/lib/server', () => ({ getServerUrl: async () => 'https://maps.example.com', setServerUrl: async (u: string) => u }));
const mockNav = {
  route: null as unknown,
  state: null as unknown,
  rerouting: false,
  error: null as string | null,
  muted: false,
  setMuted: jest.fn(),
  position: null,
  stop: jest.fn(),
};
let mockTakes = 0;
jest.mock('../src/nav/useTurnByTurn', () => ({ useTurnByTurn: () => mockNav }));
jest.mock('../src/lib/plannedStore', () => ({
  setRouteToNavigate: jest.fn(),
  takeRouteToNavigate: () => {
    mockTakes++;
    return require('./fakes').route();
  },
}));

beforeEach(() => {
  resetFakes();
  mockTakes = 0;
  Object.assign(mockNav, { route: route(), state: null, rerouting: false, error: null, muted: false });
  fake.status = 'anonymous';
  fake.api.on({ 'GET api/coverage/stats': () => coverageStats(), 'GET api/coverage': () => ({ type: 'FeatureCollection', features: [] }), 'GET api/trips/t-1': () => tripDetail() });
});

const sizes = [
  ['a phone', WINDOWS.phone],
  ['a 600 dp window', WINDOWS.medium],
  ['a 1000 dp window', WINDOWS.tablet],
] as const;

/** Every value of one style property (say maxWidth) on the screen, by walking what it rendered. */
function styleValues(prop: 'maxWidth' | 'width'): unknown[] {
  const found: unknown[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as { props?: { style?: unknown }; children?: unknown[] };
    const v = StyleSheet.flatten(node.props?.style as never)?.[prop];
    if (v !== undefined) found.push(v);
    node.children?.forEach(walk);
  };
  [screen.toJSON()].flat().forEach(walk);
  return found;
}
/** Let the screen's own requests finish, so none lands after the test. */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));
const maxWidths = () => styleValues('maxWidth');

describe('window size classes', () => {
  it('sorts windows the way Android does', () => {
    expect(layoutFor(393, 851)).toMatchObject({ sizeClass: 'compact', phone: true, sideBySide: false });
    expect(layoutFor(600, 960)).toMatchObject({ sizeClass: 'medium', phone: false, sideBySide: false });
    expect(layoutFor(841, 701)).toMatchObject({ sizeClass: 'expanded', phone: false, sideBySide: true });
    expect(layoutFor(1600, 900)).toMatchObject({ sizeClass: 'expanded', sideBySide: true });
    // A phone on its side is still a phone, and short enough to want the map beside the details.
    expect(layoutFor(851, 393)).toMatchObject({ phone: true, sideBySide: true });
  });
});

describe.each(sizes)('sign in and register on %s', (_name, size) => {
  beforeEach(() => windowSize(size.width, size.height));

  it('keeps the form to a readable width', async () => {
    await renderScreen(<SignIn />);
    await screen.findByDisplayValue('https://maps.example.com');
    expect(maxWidths()).toContain(FORM_MAX_WIDTH);
    expect(screen.getByLabelText('Password')).toBeOnTheScreen();
  });

  it('does the same on the register form', async () => {
    await renderScreen(<Register />);
    await screen.findByDisplayValue('https://maps.example.com');
    expect(maxWidths()).toContain(FORM_MAX_WIDTH);
  });
});

describe.each(sizes)('map screens on %s', (_name, size) => {
  const wide = size === WINDOWS.tablet;
  beforeEach(() => windowSize(size.width, size.height));

  it.each([
    ['Plan', () => <Plan />, '38%'],
    ['Discover', () => <Discover />, '34%'],
    ['Coverage', () => <Coverage />, '48%'],
  ] as const)('%s stacks the map over the details, or puts them side by side when wide', async (_n, ui, height) => {
    await renderScreen(ui());
    await settle();
    expect(fake.map.props.style).toEqual(wide ? { flex: 1 } : { height });
    expect(screen.getByTestId('map')).toBeOnTheScreen();
  });

  it('Trip replay does the same', async () => {
    fake.params = { id: 't-1' };
    await renderScreen(<Trip />);
    expect(await screen.findByText('Drive · 18 km')).toBeOnTheScreen();
    expect(fake.map.props.style).toEqual(wide ? { flex: 1 } : { height: '50%' });
  });

  it('Navigate shows the map, the turn and the controls', async () => {
    await renderScreen(<Navigate />);
    expect(screen.getByTestId('map')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'End' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Mute voice' })).toBeOnTheScreen();
  });
});

describe('state across a change of window size', () => {
  it('keeps the Navigate screen, its map and the running trip through a rotation and a fold', async () => {
    mockNav.state = { status: 'navigating', nextInstruction: { sign: -2, text: 'Turn left onto Logan Road' }, distanceToNextManeuverM: 180, remainingDurationS: 600, remainingDistanceM: 5400 };
    await renderScreen(<Navigate />);
    expect(screen.getByText('Turn left onto Logan Road')).toBeOnTheScreen();
    expect(fake.map.props.followUser).toBe(true);

    for (const w of [WINDOWS.phoneLandscape, WINDOWS.tablet, WINDOWS.phone]) {
      await resizeWindow(w.width, w.height);
      expect(screen.getByText('Turn left onto Logan Road')).toBeOnTheScreen();
      expect(screen.getByText('5.4 km to go')).toBeOnTheScreen();
      expect(fake.map.props.followUser).toBe(true);
    }
    // One map and one trip all along: nothing was recreated, and the trip was not ended.
    expect(fake.map.mounts).toBe(1);
    expect(mockTakes).toBe(1);
    expect(mockNav.stop).not.toHaveBeenCalled();
  });

  it('lays Navigate out beside the map only when the window is wide', async () => {
    await renderScreen(<Navigate />);
    expect(styleValues('width')).not.toContain(PANEL_WIDTH);
    await resizeWindow(WINDOWS.tablet.width, WINDOWS.tablet.height);
    // The banner and the bar share a left panel; the map takes the rest.
    expect(styleValues('width').filter((w) => w === PANEL_WIDTH)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'End' })).toBeOnTheScreen();
  });

  it('keeps what was typed in Plan, and the places chosen, when the window changes', async () => {
    await renderScreen(<Plan />);
    await fireEvent.changeText(screen.getByLabelText('Destination'), 'Gum');
    await resizeWindow(WINDOWS.tablet.width, WINDOWS.tablet.height);
    expect(screen.getByLabelText('Destination')).toHaveDisplayValue('Gum');
    await resizeWindow(WINDOWS.phone.width, WINDOWS.phone.height);
    expect(screen.getByLabelText('Destination')).toHaveDisplayValue('Gum');
    expect(fake.map.mounts).toBe(1);
  });

  it('keeps what was typed on the sign-in form', async () => {
    await renderScreen(<SignIn />);
    await screen.findByDisplayValue('https://maps.example.com');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'sam@example.com');
    await resizeWindow(WINDOWS.foldable.width, WINDOWS.foldable.height);
    expect(screen.getByLabelText('Email')).toHaveDisplayValue('sam@example.com');
  });
});
