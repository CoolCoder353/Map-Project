/// <reference types="jest" />
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import Coverage from '../app/(tabs)/coverage';
import Discover from '../app/(tabs)/discover';
import TabsLayout from '../app/(tabs)/_layout';
import Trips from '../app/(tabs)/trips';
import Index from '../app/index';
import Register from '../app/register';
import Trip from '../app/trip/[id]';
import { apiError, coverageStats, discoverItem, fake, place, renderScreen, resetFakes, trip, tripDetail } from './fakes';
import { user } from './mocks';
import { takeTripToPlan } from '../src/lib/plannedStore';

jest.mock('expo-router', () => {
  const fakes = require('./fakes');
  const { Text } = require('react-native');
  const Tabs = ({ children }: { children: unknown }) => children;
  Tabs.Screen = ({ name }: { name: string }) => <Text>{`tab:${name}`}</Text>;
  return { ...fakes.routerModule, Tabs };
});
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('../src/lib/session', () => require('./fakes').sessionModule);
jest.mock('../src/lib/appConfig', () => require('./fakes').appConfigModule);
jest.mock('../src/map/MapCanvas', () => require('./fakes').mapCanvasModule);
jest.mock('../src/lib/contacts', () => ({ findContacts: async () => [] }));
jest.mock('../src/lib/useApproxLocation', () => ({ useApproxLocation: () => undefined }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
const mockSetServerUrl = jest.fn(async (u: string) => u);
jest.mock('../src/lib/server', () => ({ getServerUrl: async () => 'https://maps.example.com', setServerUrl: (u: string) => mockSetServerUrl(u) }));

beforeEach(() => resetFakes());
afterEach(() => expect(fake.api.unhandled).toEqual([]));

describe('Coverage', () => {
  it('shows kilometres of road and road counts, and loads roads for the map’s view', async () => {
    fake.api.on({
      'GET api/coverage/stats': () => coverageStats(),
      'GET api/coverage': () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { recent: true }, geometry: { type: 'LineString', coordinates: [[153, -27], [153.1, -27]] } }] }),
    });
    await renderScreen(<Coverage />);
    expect(await screen.findByRole('header', { name: /412.5 km of road travelled/ })).toBeOnTheScreen();
    expect(screen.getByText('+17 new roads this week')).toBeOnTheScreen();
    expect(screen.getByText('1,234')).toBeOnTheScreen();
    expect(screen.getByText('12.5 km')).toBeOnTheScreen();
    expect(screen.queryByText(/Background tracking is off/)).toBeNull();
    await (fake.map.props.onRegionChange as (b: number[], z: number) => void)([152.9, -27.6, 200, -27.3], 12.3);
    await waitFor(() => expect(fake.map.props.coverage).toMatchObject({ type: 'FeatureCollection' }));
    expect(fake.api.callsTo('GET api/coverage')[0]!.query).toEqual({ bbox: '152.90000,-27.60000,180.00000,-27.30000', zoom: 12.5, format: 'geojson' });
  });

  it('opens on the roads travelled, and fetches them again on coming back or pulling down', async () => {
    let roadKm = 412.5;
    fake.api.on({
      'GET api/coverage/stats': () => coverageStats({ roadKm, bounds: [153.1, -27.6, 153.3, -27.4] }),
      'GET api/coverage': () => ({ type: 'FeatureCollection', features: [] }),
    });
    await renderScreen(<Coverage />);
    await screen.findByRole('header', { name: /412.5 km/ });
    expect(fake.map.fitTo).toHaveBeenCalledWith([[153.1, -27.6], [153.3, -27.4]]);
    await (fake.map.props.onRegionChange as (b: number[], z: number) => void)([153, -27.7, 153.4, -27.3], 12);
    await waitFor(() => expect(fake.api.callsTo('GET api/coverage')).toHaveLength(1));
    expect(fake.api.callsTo('GET api/coverage/stats')).toHaveLength(1);

    // A trip was recorded while on another tab.
    roadKm = 415;
    await act(async () => fake.focus());
    expect(await screen.findByRole('header', { name: /415 km/ })).toBeOnTheScreen();
    expect(fake.api.callsTo('GET api/coverage')).toHaveLength(2);
    expect(fake.api.callsTo('GET api/coverage')[1]!.query).toMatchObject({ bbox: '153.00000,-27.70000,153.40000,-27.30000' });

    roadKm = 420;
    // Pulling the stats down: the scroll view's refresh control.
    const scroll = screen.getByTestId('coverage-details');
    await act(async () => (scroll.props as { refreshControl: { props: { onRefresh(): void } } }).refreshControl.props.onRefresh());
    expect(await screen.findByRole('header', { name: /420 km/ })).toBeOnTheScreen();
    expect(fake.api.callsTo('GET api/coverage')).toHaveLength(3);
    // Framed once; after that the map stays where it was put.
    expect(fake.map.fitTo).toHaveBeenCalledTimes(1);
  });

  it('explains an empty map and tracking being off, in the chosen voice', async () => {
    fake.user = user(false);
    fake.config = { ...fake.config, voice: 'playful' };
    fake.api.on({ 'GET api/coverage/stats': () => coverageStats({ roadsTravelled: 0, roadKm: 0 }) });
    await renderScreen(<Coverage />);
    expect(await screen.findByText(/No roads travelled yet/)).toBeOnTheScreen();
    expect(screen.getByText(/Tracking’s off/)).toBeOnTheScreen();
    expect(screen.queryByText(/hexagon|fog/i)).toBeNull();
  });

  it('shows why the numbers couldn’t load', async () => {
    fake.api.on({ 'GET api/coverage/stats': () => apiError(0, 'Can’t reach maps.example.com. Check the server address and your connection.') });
    await renderScreen(<Coverage />);
    expect(await screen.findByText(/Can’t reach maps\.example\.com/)).toBeOnTheScreen();
  });
});

describe('Discover', () => {
  it('needs a start, then finds places by category and time', async () => {
    fake.api.on({
      'GET api/search': () => ({ results: [place()] }),
      'GET api/discover': () => ({ items: [discoverItem(), discoverItem({ id: 'd-2', name: 'Cafe Nine', category: 'cafe', areaUnexploredPct: 10 })] }),
    });
    await renderScreen(<Discover />);
    expect(screen.getByRole('button', { name: 'Find places' })).toBeDisabled();
    const from = screen.getByLabelText('Search from');
    await fireEvent(from, 'focus');
    await fireEvent.changeText(from, 'gumdale');
    await fireEvent.press(await screen.findByText('Gumdale State School'));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Lookouts' }));
    await fireEvent.press(screen.getByRole('button', { name: '+' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Walk' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Find places' }));
    expect(await screen.findByText('Mount Coot-tha Lookout')).toBeOnTheScreen();
    expect(screen.getByText('80% unexplored area')).toBeOnTheScreen();
    expect(screen.queryByText('10% unexplored area')).toBeNull();
    expect(fake.api.callsTo('GET api/discover')[0]!.query).toEqual({ lon: 153.15, lat: -27.49, mode: 'foot', maxMinutes: 35, categories: 'viewpoint', limit: 25 });
    expect(fake.map.fitTo).toHaveBeenCalled();
    // A place found is somewhere to go: Plan works out the trip there, from the same start, walking.
    await fireEvent.press(screen.getByText('Mount Coot-tha Lookout'));
    expect(fake.router.navigate).toHaveBeenCalledWith('/plan');
    expect(takeTripToPlan()).toMatchObject({ from: { name: 'Gumdale State School', location: [153.15, -27.49] }, to: { name: 'Mount Coot-tha Lookout', location: [152.95, -27.48] }, mode: 'foot' });
  });

  it('says when nothing new is in reach, and shows errors', async () => {
    let fail = false;
    fake.api.on({ 'GET api/search': () => ({ results: [place()] }), 'GET api/discover': () => (fail ? apiError(503, 'Routing is down') : { items: [] }) });
    await renderScreen(<Discover />);
    const from = screen.getByLabelText('Search from');
    await fireEvent(from, 'focus');
    await fireEvent.changeText(from, 'gumdale');
    await fireEvent.press(await screen.findByText('Gumdale State School'));
    await fireEvent.press(screen.getByRole('button', { name: 'Find places' }));
    expect(await screen.findByText(/Nothing new within reach/)).toBeOnTheScreen();
    fail = true;
    await fireEvent.press(screen.getByRole('button', { name: 'Find places' }));
    expect(await screen.findByText('Routing is down')).toBeOnTheScreen();
  });

  it('lists a kind of place this version doesn’t know yet instead of crashing', async () => {
    fake.api.on({ 'GET api/search': () => ({ results: [place()] }), 'GET api/discover': () => ({ items: [discoverItem({ category: 'hot_spring' as never, name: 'Innot Hot Springs' })] }) });
    await renderScreen(<Discover />);
    const from = screen.getByLabelText('Search from');
    await fireEvent(from, 'focus');
    await fireEvent.changeText(from, 'gumdale');
    await fireEvent.press(await screen.findByText('Gumdale State School'));
    await fireEvent.press(screen.getByRole('button', { name: 'Find places' }));
    expect(await screen.findByText('Innot Hot Springs')).toBeOnTheScreen();
    expect(screen.getByText(/^Place · 7\.4 km away/)).toBeOnTheScreen();
  });

  it('clears places found from a start that’s been cleared', async () => {
    fake.api.on({ 'GET api/search': () => ({ results: [place()] }), 'GET api/discover': () => ({ items: [discoverItem()] }) });
    await renderScreen(<Discover />);
    const from = screen.getByLabelText('Search from');
    await fireEvent(from, 'focus');
    await fireEvent.changeText(from, 'gumdale');
    await fireEvent.press(await screen.findByText('Gumdale State School'));
    await fireEvent.press(screen.getByRole('button', { name: 'Find places' }));
    expect(await screen.findByText('Mount Coot-tha Lookout')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear search from' }));
    expect(screen.queryByText('Mount Coot-tha Lookout')).toBeNull();
  });
});

describe('Trips', () => {
  it('lists trips with mode, new roads and navigation, and opens one', async () => {
    fake.api.on({ 'GET api/trips': () => ({ items: [trip(), trip({ id: 't-2', mode: 'foot', source: 'navigation', newRoads: 1 }), trip({ id: 't-3', newRoads: 0 })], nextCursor: null }) });
    await renderScreen(<Trips />);
    expect(await screen.findByText('3 new roads')).toBeOnTheScreen();
    expect(screen.getByText('1 new road')).toBeOnTheScreen();
    expect(screen.getByText('Walk, navigated')).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole('button')[0]!);
    expect(fake.router.push).toHaveBeenCalledWith('/trip/t-1');
  });

  it('says when there are none yet', async () => {
    fake.api.on({ 'GET api/trips': () => ({ items: [], nextCursor: null }) });
    await renderScreen(<Trips />);
    expect(await screen.findByText(/No trips yet/)).toBeOnTheScreen();
  });

  it('says trips couldn’t load, rather than that there are none', async () => {
    fake.api.on({ 'GET api/trips': () => apiError(503, 'The server had a problem. Try again shortly.') });
    await renderScreen(<Trips />);
    expect(await screen.findByText('The server had a problem. Try again shortly.')).toBeOnTheScreen();
    expect(screen.queryByText(/No trips yet/)).toBeNull();
  });
});

describe('Trip', () => {
  it('draws the recorded line and deletes after confirming', async () => {
    fake.params = { id: 't-1' };
    fake.api.on({ 'GET api/trips/t-1': () => tripDetail(), 'DELETE api/trips/t-1': () => ({ ok: true }) });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderScreen(<Trip />);
    expect(await screen.findByText('Drive · 18 km')).toBeOnTheScreen();
    expect(screen.getByText('3 roads you’d never travelled before')).toBeOnTheScreen();
    expect(fake.map.props.track).toEqual([[153, -27.4], [153.05, -27.45], [153.1, -27.5]]);
    expect(fake.map.fitTo).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete trip' }));
    expect(alert.mock.calls[0]![0]).toBe('Delete this trip?');
    const buttons = alert.mock.calls[0]![2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Delete')!.onPress!());
    await waitFor(() => expect(fake.router.back).toHaveBeenCalled());
    expect(fake.api.callsTo('DELETE api/trips/t-1')).toHaveLength(1);
  });

  it('shows a trip that can’t be loaded', async () => {
    fake.params = { id: 't-9' };
    fake.api.on({ 'GET api/trips/t-9': () => apiError(404, 'Trip not found') });
    await renderScreen(<Trip />);
    expect(await screen.findByText('Trip not found')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Trips' }));
    expect(fake.router.back).toHaveBeenCalled();
  });

  it('says a delete failed and stays on the trip', async () => {
    fake.params = { id: 't-1' };
    fake.api.on({ 'GET api/trips/t-1': () => tripDetail(), 'DELETE api/trips/t-1': () => apiError(503, 'Try again shortly.') });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderScreen(<Trip />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete trip' }));
    const buttons = alert.mock.calls[0]![2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Delete')!.onPress!());
    expect(await screen.findByText('Couldn’t delete the trip. Try again shortly.')).toBeOnTheScreen();
    expect(fake.router.back).not.toHaveBeenCalled();
  });

  it('goes to the trip list when opened from a link, with nothing to go back to', async () => {
    fake.params = { id: 't-1' };
    fake.router.canGoBack.mockReturnValueOnce(false);
    fake.api.on({ 'GET api/trips/t-1': () => tripDetail() });
    await renderScreen(<Trip />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Trips' }));
    expect(fake.router.back).not.toHaveBeenCalled();
    expect(fake.router.replace).toHaveBeenCalledWith('/trips');
  });
});

describe('Register', () => {
  const fill = async (password = 'long enough pw') => {
    await renderScreen(<Register />);
    await screen.findByDisplayValue('https://maps.example.com');
    await fireEvent.changeText(screen.getByLabelText('Invite code'), 'abcd-efgh');
    await fireEvent.changeText(screen.getByLabelText('Email'), ' new@example.test ');
    await fireEvent.changeText(screen.getByLabelText('Password'), password);
  };

  it('creates the account on the chosen server and opens Plan', async () => {
    await fill();
    expect(screen.getByLabelText('Invite code')).toHaveDisplayValue('ABCD-EFGH');
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(fake.router.replace).toHaveBeenCalledWith('/plan'));
    expect(mockSetServerUrl).toHaveBeenCalledWith('https://maps.example.com');
    expect(fake.session.register).toHaveBeenCalledWith('ABCD-EFGH', 'new@example.test', 'long enough pw');
  });

  it('checks the password length first, and shows server errors', async () => {
    await fill('short');
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use at least 10 characters for your password.')).toBeOnTheScreen();
    expect(fake.session.register).not.toHaveBeenCalled();
    fake.session.register.mockRejectedValueOnce(new Error('That invite code has expired.'));
    await fireEvent.changeText(screen.getByLabelText('Password'), 'long enough pw');
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('That invite code has expired.')).toBeOnTheScreen();
    expect(fake.router.replace).not.toHaveBeenCalled();
  });

  it('shows the server address as it was saved, and refuses one that can’t work', async () => {
    await fill();
    mockSetServerUrl.mockResolvedValueOnce('https://maps.example.org');
    await fireEvent.changeText(screen.getByLabelText('Server'), 'Maps.Example.org');
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getByLabelText('Server')).toHaveDisplayValue('https://maps.example.org'));
    mockSetServerUrl.mockRejectedValueOnce(new Error('Enter your group’s server address, like maps.example.com.'));
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/like maps\.example\.com/)).toBeOnTheScreen();
    expect(fake.session.register).toHaveBeenCalledTimes(1);
  });
});

describe('Start-up routing', () => {
  it('sends signed-in people to Plan and others to sign in', async () => {
    fake.status = 'loading';
    const { rerender } = await renderScreen(<Index />);
    expect(screen.queryByText(/Redirect/)).toBeNull();
    fake.status = 'authenticated';
    await rerender(<Index />);
    expect(screen.getByText('Redirect to /plan')).toBeOnTheScreen();
    fake.status = 'anonymous';
    await rerender(<Index />);
    expect(screen.getByText('Redirect to /sign-in')).toBeOnTheScreen();
  });

  it('says the server can’t be reached, rather than asking a signed-in person to sign in again', async () => {
    fake.status = 'offline';
    await renderScreen(<Index />);
    expect(screen.getByText('Can’t reach the server')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(fake.session.retry).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in with a different server' }));
    expect(fake.router.push).toHaveBeenCalledWith('/sign-in');
    await renderScreen(<TabsLayout />);
    expect(screen.getByText('Redirect to /')).toBeOnTheScreen();
  });

  it('shows the five tabs only when signed in', async () => {
    fake.status = 'anonymous';
    const { rerender } = await renderScreen(<TabsLayout />);
    expect(screen.getByText('Redirect to /sign-in')).toBeOnTheScreen();
    fake.status = 'authenticated';
    await rerender(<TabsLayout />);
    for (const tab of ['plan', 'discover', 'coverage', 'trips', 'settings']) expect(screen.getByText(`tab:${tab}`)).toBeOnTheScreen();
  });
});
