/// <reference types="jest" />
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import Plan from '../app/(tabs)/plan';
import { takeRouteToNavigate } from '../src/lib/plannedStore';
import { apiError, fake, place, renderScreen, resetFakes, route } from './fakes';
import { user } from './mocks';

jest.mock('expo-router', () => require('./fakes').routerModule);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('../src/lib/session', () => require('./fakes').sessionModule);
jest.mock('../src/lib/appConfig', () => require('./fakes').appConfigModule);
jest.mock('../src/map/MapCanvas', () => require('./fakes').mapCanvasModule);
jest.mock('../src/lib/contacts', () => ({ findContacts: async () => [] }));
let mockHere: [number, number] | undefined;
jest.mock('../src/lib/useApproxLocation', () => ({ useApproxLocation: () => mockHere }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

const explore = route({ id: 'r-exp', kind: 'explore', extraDurationS: 420, novelty: { totalKm: 14, newKm: 6.2, noveltyPct: 44 } });

beforeEach(() => {
  resetFakes();
  mockHere = [153.02, -27.47];
  fake.api.on({
    'GET api/search': () => ({ results: [place()] }),
    'POST api/routes/explore': () => ({ fastest: route(), explore: [explore] }),
  });
});

async function chooseDestination() {
  const box = screen.getByLabelText('Destination');
  await fireEvent(box, 'focus');
  await fireEvent.changeText(box, 'gumdale');
  await fireEvent.press(await screen.findByText('Gumdale State School'));
}

it('starts from where you are, once', async () => {
  await renderScreen(<Plan />);
  expect(screen.getByLabelText('Starting point')).toHaveDisplayValue('Your location');
  await fireEvent.press(screen.getByRole('button', { name: 'Clear starting point' }));
  expect(screen.getByLabelText('Starting point')).toHaveDisplayValue('');
});

it('compares the fastest route with explore routes and starts navigation on one', async () => {
  fake.user = user(true);
  await renderScreen(<Plan />);
  expect(screen.getByText(/Choose where you’re going/)).toBeOnTheScreen();
  await chooseDestination();
  expect(await screen.findByText('Explore 1')).toBeOnTheScreen();
  expect(screen.getByText('Fastest')).toBeOnTheScreen();
  expect(fake.api.callsTo('POST api/routes/explore')[0]!.body).toEqual({ from: [153.02, -27.47], to: [153.15, -27.49], mode: 'car', budgetMin: 15 });
  expect(fake.map.fitTo).toHaveBeenCalled();
  expect(fake.map.props.markers).toEqual([
    { id: 'from', lngLat: [153.02, -27.47], kind: 'start', label: 'Your location' },
    { id: 'to', lngLat: [153.15, -27.49], kind: 'end', label: 'Gumdale State School' },
  ]);
  (fake.map.props.onRoutePress as (id: string) => void)('r-exp');
  await waitFor(() => expect(fake.map.props.selectedRouteId).toBe('r-exp'));
  // Only the selected route offers Start.
  await fireEvent.press(screen.getByRole('button', { name: 'Start' }));
  expect(fake.router.push).toHaveBeenCalledWith('/navigate');
  expect(takeRouteToNavigate()?.id).toBe('r-exp');
});

it('re-plans for walking and a bigger budget', async () => {
  await renderScreen(<Plan />);
  await chooseDestination();
  await screen.findByText('Explore 1');
  await fireEvent.press(screen.getByRole('radio', { name: 'Walk' }));
  await waitFor(() => expect(fake.api.callsTo('POST api/routes/explore').at(-1)!.body).toMatchObject({ mode: 'foot' }));
  await fireEvent.press(screen.getByRole('button', { name: '+' }));
  await waitFor(() => expect(fake.api.callsTo('POST api/routes/explore').at(-1)!.body).toMatchObject({ budgetMin: 20 }));
  expect(screen.getByText('Up to 20 min extra')).toBeOnTheScreen();
});

it('explains an empty explore list', async () => {
  fake.api.on({ 'POST api/routes/explore': () => ({ fastest: route(), explore: [] }) });
  await renderScreen(<Plan />);
  await chooseDestination();
  expect(await screen.findByText('No explore routes fit within 15 extra minutes.')).toBeOnTheScreen();
  fake.api.on({ 'POST api/routes/explore': () => ({ fastest: route({ novelty: { totalKm: 12, newKm: 12, noveltyPct: 100 } }), explore: [] }) });
  await fireEvent.press(screen.getByRole('radio', { name: 'Walk' }));
  expect(await screen.findByText(/already explores somewhere new/)).toBeOnTheScreen();
});

it('shows routing errors', async () => {
  fake.api.on({ 'POST api/routes/explore': () => apiError(422, 'There is no road or path near your destination.') });
  await renderScreen(<Plan />);
  await chooseDestination();
  expect(await screen.findByText('There is no road or path near your destination.')).toBeOnTheScreen();
});

it('makes round trips from the start', async () => {
  fake.api.on({ 'POST api/routes/roundtrip': () => ({ routes: [route({ id: 'l1', kind: 'roundtrip' }), route({ id: 'l2', kind: 'roundtrip' })] }) });
  await renderScreen(<Plan />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Round trip' }));
  expect(screen.queryByLabelText('Destination')).toBeNull();
  await fireEvent.press(screen.getAllByRole('button', { name: '+' })[0]!);
  await fireEvent.press(screen.getByRole('button', { name: 'Make loops' }));
  expect(await screen.findByText('Loop 2')).toBeOnTheScreen();
  expect(fake.api.callsTo('POST api/routes/roundtrip')[0]!.body).toEqual({ start: [153.02, -27.47], mode: 'car', targetMin: 75 });
  expect(screen.getByRole('button', { name: 'Make new loops' })).toBeOnTheScreen();
});

it('says when no loop fits, and needs a start', async () => {
  mockHere = undefined;
  fake.api.on({ 'POST api/routes/roundtrip': () => ({ routes: [] }) });
  await renderScreen(<Plan />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Round trip' }));
  expect(screen.getByRole('button', { name: 'Make loops' })).toBeDisabled();
  const start = screen.getByLabelText('Starting point');
  await fireEvent(start, 'focus');
  await fireEvent.changeText(start, 'gumdale');
  await fireEvent.press(await screen.findByText('Gumdale State School'));
  await fireEvent.press(screen.getByRole('button', { name: 'Make loops' }));
  expect(await screen.findByText(/Couldn’t make a loop that length from here/)).toBeOnTheScreen();
});

it('drops round trips that arrive after switching to directions, rather than crashing', async () => {
  let answer: (v: unknown) => void = () => undefined;
  fake.api.on({ 'POST api/routes/roundtrip': () => new Promise((resolve) => (answer = resolve)) });
  await renderScreen(<Plan />);
  await fireEvent.press(screen.getByRole('radio', { name: 'Round trip' }));
  // Not awaited: fireEvent.press resolves with the handler's promise, which is still waiting.
  void fireEvent.press(screen.getByRole('button', { name: 'Make loops' }));
  await waitFor(() => expect(fake.api.callsTo('POST api/routes/roundtrip')).toHaveLength(1));
  await fireEvent.press(screen.getByRole('radio', { name: 'Directions' }));
  // No loop fitted: an empty list used to reach the Directions cards, which read routes[0].id.
  await act(async () => answer({ routes: [] }));
  expect(screen.getByText(/Choose where you’re going/)).toBeOnTheScreen();
  expect(screen.queryByText(/Couldn’t make a loop/)).toBeNull();
});

it('forgets routes when the destination is cleared, so Start can’t go to the old one', async () => {
  await renderScreen(<Plan />);
  await chooseDestination();
  expect(await screen.findByText('Explore 1')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Clear destination' }));
  expect(screen.queryByText('Fastest')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  expect(fake.map.props.routes).toEqual([]);
});

it('keeps what you type over a chosen place', async () => {
  await renderScreen(<Plan />);
  await chooseDestination();
  const box = screen.getByLabelText('Destination');
  await fireEvent(box, 'focus');
  await fireEvent.changeText(box, 'Gumdale State SchoolX');
  expect(box).toHaveDisplayValue('Gumdale State SchoolX');
});

afterEach(() => expect(fake.api.unhandled).toEqual([]));

describe('handing over to Google Maps', () => {
  it('offers it once there is a destination, with the start unless it is where you are', async () => {
    const { openURL } = jest.requireMock<{ openURL: jest.Mock }>('expo-linking');
    await renderScreen(<Plan />);
    expect(screen.queryByRole('button', { name: 'Open in Google Maps' })).toBeNull();
    await chooseDestination();
    await fireEvent.press(await screen.findByRole('button', { name: 'Open in Google Maps' }));
    expect(openURL).toHaveBeenLastCalledWith('https://www.google.com/maps/dir/?api=1&destination=-27.49%2C153.15&travelmode=driving');
    await fireEvent.press(screen.getByRole('radio', { name: 'Walk' }));
    const box = screen.getByLabelText('Starting point');
    await fireEvent(box, 'focus');
    await fireEvent.changeText(box, 'gumdale');
    await fireEvent.press(await screen.findByText('Gumdale State School'));
    await fireEvent.press(screen.getByRole('button', { name: 'Open in Google Maps' }));
    expect(openURL).toHaveBeenLastCalledWith('https://www.google.com/maps/dir/?api=1&origin=-27.49%2C153.15&destination=-27.49%2C153.15&travelmode=walking');
  });

  it('says so when nothing can open it', async () => {
    const { openURL } = jest.requireMock<{ openURL: jest.Mock }>('expo-linking');
    openURL.mockRejectedValueOnce(new Error('No activity'));
    await renderScreen(<Plan />);
    await chooseDestination();
    await fireEvent.press(await screen.findByRole('button', { name: 'Open in Google Maps' }));
    expect(await screen.findByText(/Couldn’t open Google Maps/)).toBeOnTheScreen();
  });
});

it('works out the trip to a place chosen in Discover, from where Discover searched', async () => {
  const { setTripToPlan } = jest.requireActual<typeof import('../src/lib/plannedStore')>('../src/lib/plannedStore');
  setTripToPlan({ from: { name: 'Gumdale State School', description: '', location: [153.15, -27.49] }, to: { name: 'Mt Coot-tha Lookout', description: 'Lookout', location: [152.95, -27.48] }, mode: 'foot' });
  await renderScreen(<Plan />);
  await waitFor(() => expect(fake.api.callsTo('POST api/routes/explore')).toHaveLength(1));
  expect(fake.api.callsTo('POST api/routes/explore')[0]!.body).toMatchObject({ from: [153.15, -27.49], to: [152.95, -27.48], mode: 'foot' });
  expect(screen.getByLabelText('Destination')).toHaveDisplayValue('Mt Coot-tha Lookout');
  // Taken once: coming back to Plan later leaves what's there.
  await act(async () => fake.focus());
  expect(fake.api.callsTo('POST api/routes/explore')).toHaveLength(1);
});

describe('saving a destination', () => {
  it('saves it as Home with one tap, under a name of your own, and says how to find it', async () => {
    fake.api.on({ 'POST api/saved-places': (init) => ({ id: 's1', ...(init.body as object), createdAt: '2026-10-08T00:00:00Z' }) });
    await renderScreen(<Plan />);
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    await chooseDestination();
    await fireEvent.press(await screen.findByRole('button', { name: 'Home' }));
    expect(await screen.findByText('Saved as Home. Type “Home” in any search to find it.')).toBeOnTheScreen();
    expect(fake.api.callsTo('POST api/saved-places')[0]!.body).toEqual({ name: 'Home', description: expect.stringContaining('Gumdale State School'), location: [153.15, -27.49] });
  });

  it('takes a name of your own', async () => {
    fake.api.on({ 'POST api/saved-places': (init) => ({ id: 's2', ...(init.body as object), createdAt: '2026-10-08T00:00:00Z' }) });
    await renderScreen(<Plan />);
    await chooseDestination();
    await fireEvent.press(await screen.findByRole('button', { name: 'Other…' }));
    await fireEvent.changeText(screen.getByLabelText('Name for this place'), '  Gym ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Saved as Gym/)).toBeOnTheScreen();
    expect((fake.api.callsTo('POST api/saved-places')[0]!.body as { name: string }).name).toBe('Gym');
  });

  it('says why it couldn’t save', async () => {
    fake.api.on({ 'POST api/saved-places': () => apiError(409, 'You can save up to 50 places. Remove one in Settings first.') });
    await renderScreen(<Plan />);
    await chooseDestination();
    await fireEvent.press(await screen.findByRole('button', { name: 'Work' }));
    expect(await screen.findByText(/You can save up to 50 places/)).toBeOnTheScreen();
  });

  it('doesn’t offer to save a place that is already saved', async () => {
    fake.api.on({ 'GET api/search': () => ({ results: [place({ id: 'saved:s1', name: 'Home', kind: 'saved', typeLabel: 'Saved place', context: '27 Whitby Place' })] }) });
    await renderScreen(<Plan />);
    const box = screen.getByLabelText('Destination');
    await fireEvent(box, 'focus');
    await fireEvent.changeText(box, 'home');
    await fireEvent.press(await screen.findByText('Home'));
    await waitFor(() => expect(screen.getByLabelText('Destination')).toHaveDisplayValue('Home'));
    expect(screen.queryByRole('button', { name: 'Other…' })).toBeNull();
  });
});
