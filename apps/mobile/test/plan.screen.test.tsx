/// <reference types="jest" />
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import Plan, { CLEARED_ZOOM, loopNote } from '../app/(tabs)/plan';
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
let mockLastPlan: unknown = null;
const mockSaved: unknown[] = [];
jest.mock('../src/lib/lastPlan', () => ({ loadLastPlan: async () => mockLastPlan, saveLastPlan: async (p: unknown) => void mockSaved.push(p) }));

// Routes from where the phone is, as the server gives them.
const fromHere = (over: Parameters<typeof route>[0] = {}) => route({ geometry: [[153.02, -27.47], [153.15, -27.49]], ...over });
const explore = fromHere({ id: 'r-exp', kind: 'explore', extraDurationS: 420, novelty: { totalKm: 14, newKm: 6.2, noveltyPct: 44 } });

beforeEach(() => {
  resetFakes();
  mockLastPlan = null;
  mockSaved.length = 0;
  mockHere = [153.02, -27.47];
  fake.api.on({
    'GET api/search': () => ({ results: [place()] }),
    'POST api/routes/explore': () => ({ fastest: fromHere(), explore: [explore] }),
    'GET api/saved-places': () => ({ items: [] }),
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
  // "Your location" is the blue dot already, so it gets no second marker (P15).
  expect(fake.map.props.markers).toEqual([
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
  await fireEvent.press(screen.getByRole('button', { name: /^More:/ }));
  await waitFor(() => expect(fake.api.callsTo('POST api/routes/explore').at(-1)!.body).toMatchObject({ budgetMin: 20 }));
  expect(screen.getByText('Up to 20 min extra')).toBeOnTheScreen();
});

it('asks for routes once quick taps on the extra time stop, not for each one', async () => {
  await renderScreen(<Plan />);
  await chooseDestination();
  await screen.findByText('Explore 1');
  const before = fake.api.callsTo('POST api/routes/explore').length;
  for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByRole('button', { name: /^More:/ }));
  expect(screen.getByText('Up to 30 min extra')).toBeOnTheScreen();
  await waitFor(() => expect(fake.api.callsTo('POST api/routes/explore')).toHaveLength(before + 1));
  expect(fake.api.callsTo('POST api/routes/explore').at(-1)!.body).toMatchObject({ budgetMin: 30 });
  // And no more come once it has asked.
  await new Promise((r) => setTimeout(r, 600));
  expect(fake.api.callsTo('POST api/routes/explore')).toHaveLength(before + 1);
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
  await fireEvent.press(screen.getAllByRole('button', { name: /^More:/ })[0]!);
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

it('swaps the start and the destination, and plans the other way', async () => {
  await renderScreen(<Plan />);
  // Nothing to swap until both are chosen.
  expect(screen.queryByRole('button', { name: 'Swap starting point and destination' })).toBeNull();
  await chooseDestination();
  await screen.findByText('Explore 1');
  await fireEvent.press(screen.getByRole('button', { name: 'Swap starting point and destination' }));
  expect(screen.getByLabelText('Starting point')).toHaveDisplayValue('Gumdale State School');
  expect(screen.getByLabelText('Destination')).toHaveDisplayValue('Your location');
  await waitFor(() => expect(fake.api.callsTo('POST api/routes/explore')).toHaveLength(2));
  expect(fake.api.callsTo('POST api/routes/explore')[1]!.body).toMatchObject({ from: [153.15, -27.49], to: [153.02, -27.47] });
});

it('offers saved places as destinations with one tap', async () => {
  fake.api.on({
    'GET api/saved-places': () => ({
      items: [
        { id: 's2', name: 'Gym', description: '', location: [153.2, -27.5], createdAt: '2026-10-02T00:00:00Z' },
        { id: 's1', name: 'Home', description: '27 Whitby Place, Thornlands', location: [153.26, -27.56], createdAt: '2026-10-01T00:00:00Z' },
      ],
    }),
  });
  await renderScreen(<Plan />);
  expect(await screen.findByRole('button', { name: 'Directions to Gym' })).toBeOnTheScreen();
  // Home first, though the server sends them by name.
  expect(screen.getAllByRole('button', { name: /^Directions to/ }).map((b) => b.props.accessibilityLabel)).toEqual(['Directions to Home', 'Directions to Gym']);
  await fireEvent.press(screen.getByRole('button', { name: 'Directions to Home' }));
  expect(screen.getByLabelText('Destination')).toHaveDisplayValue('Home');
  await waitFor(() => expect(fake.api.callsTo('POST api/routes/explore')).toHaveLength(1));
  expect(fake.api.callsTo('POST api/routes/explore')[0]!.body).toMatchObject({ from: [153.02, -27.47], to: [153.26, -27.56] });
  // Chosen: the shortcuts go, and a saved place isn't offered for saving again.
  expect(screen.queryByRole('button', { name: 'Directions to Gym' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Other…' })).toBeNull();
});

it('says when nothing matches what was typed', async () => {
  fake.api.on({ 'GET api/search': ({ query }) => ({ results: query?.q === 'zzqx' ? [] : [place()] }) });
  await renderScreen(<Plan />);
  const box = screen.getByLabelText('Destination');
  await fireEvent(box, 'focus');
  await fireEvent.changeText(box, 'zzqx');
  expect(await screen.findByText('No places match “zzqx”.')).toBeOnTheScreen();
  await fireEvent.changeText(box, 'gumdale');
  expect(await screen.findByText('Gumdale State School')).toBeOnTheScreen();
  expect(screen.queryByText(/No places match/)).toBeNull();
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
    // Starts with the place's own name, to keep or change.
    expect(screen.getByLabelText('Name for this place')).toHaveDisplayValue('Gumdale State School');
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

/** Plan inside a parent the test can re-render, as a new position or settings would. */
let bump: () => void = () => undefined;
function Host() {
  const [, setN] = useState(0);
  bump = () => setN((n) => n + 1);
  return <Plan />;
}

describe('the 9 November phone run', () => {
  it('moves “Your location” with you and plans again from where you are now (P14)', async () => {
    await renderScreen(<Host />);
    await chooseDestination();
    await screen.findByText('Explore 1');
    mockHere = [153.2, -27.52];
    await act(async () => bump());
    await waitFor(() => expect(fake.api.callsTo('POST api/routes/explore').at(-1)!.body).toMatchObject({ from: [153.2, -27.52] }));
    expect(screen.getByLabelText('Starting point')).toHaveDisplayValue('Your location');
  });

  it('never offers to save “Your location” or a whole suburb (P81, P11)', async () => {
    fake.api.on({ 'GET api/search': () => ({ results: [place({ id: 'sub', name: 'Mount Coot-tha', kind: 'suburb', typeLabel: 'Suburb', context: 'Brisbane QLD' })] }) });
    await renderScreen(<Plan />);
    const box = screen.getByLabelText('Destination');
    await fireEvent(box, 'focus');
    await fireEvent.changeText(box, 'coot');
    await fireEvent.press(await screen.findByText('Mount Coot-tha'));
    await waitFor(() => expect(screen.getByLabelText('Destination')).toHaveDisplayValue('Mount Coot-tha'));
    expect(screen.queryByRole('button', { name: 'Other…' })).toBeNull();
  });

  it('takes a new extra-time default from Settings without a restart (P92)', async () => {
    fake.user = user(true);
    await renderScreen(<Host />);
    await chooseDestination();
    await screen.findByText('Explore 1');
    fake.user = { ...fake.user!, settings: { ...fake.user!.settings, exploreBudgetMin: 30 } };
    await act(async () => bump());
    await waitFor(() => expect(fake.api.callsTo('POST api/routes/explore').at(-1)!.body).toMatchObject({ budgetMin: 30 }));
  });

  it('keeps Round trip’s travel mode to itself (P82)', async () => {
    fake.api.on({ 'POST api/routes/roundtrip': () => ({ routes: [route({ id: 'loop1', kind: 'roundtrip' })] }) });
    await renderScreen(<Plan />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Round trip' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Walk' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Directions' }));
    expect(screen.getByRole('radio', { name: 'Drive' })).toBeChecked();
  });
});

// A route from somewhere else would say "You've arrived" or "Off route" at once (P83).
it('asks before starting a route that begins somewhere else, and can plan it from here instead', async () => {
  fake.api.on({ 'POST api/routes/explore': () => ({ fastest: route(), explore: [] }) });
  await renderScreen(<Plan />);
  await chooseDestination();
  await screen.findByText('Fastest');
  await fireEvent.press(screen.getByRole('button', { name: 'Start' }));
  expect(fake.router.push).not.toHaveBeenCalled();
  expect(screen.getByText(/This route starts at Your location, .* from where you are/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Start anyway' }));
  expect(fake.router.push).toHaveBeenCalledWith('/navigate');
});

// Starting another trip ends the one running: said before Start is tapped (C14).
it('says when directions are already running', async () => {
  const { navigation } = jest.requireActual<typeof import('../src/nav/navigationService')>('../src/nav/navigationService');
  const snap = jest.spyOn(navigation, 'getSnapshot').mockReturnValue({ ...navigation.getSnapshot(), active: true, destinationName: 'Coot-tha Place' });
  try {
    await renderScreen(<Plan />);
    expect(screen.getByText('Directions to Coot-tha Place are running. Starting a route here ends them.')).toBeOnTheScreen();
  } finally {
    snap.mockRestore();
  }
});

it('makes the map bigger and back (P12)', async () => {
  await renderScreen(<Plan />);
  await fireEvent.press(screen.getByRole('button', { name: 'Bigger map' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Smaller map' }));
  expect(screen.getByRole('button', { name: 'Bigger map' })).toBeOnTheScreen();
});

it('says when a loop runs over the time asked for (P69)', () => {
  expect(loopNote(route({ durationS: 64 * 60 }), 60)).toBe('4 min longer than the 1 h you asked for');
  expect(loopNote(route({ durationS: 61 * 60 }), 60)).toBeNull();
});

// "Navigating to Gumdale State School" in the notification and the car, not just "Navigating" (P91).
it('names where a trip goes when it starts', async () => {
  const { destinationToNavigate } = jest.requireActual<typeof import('../src/lib/plannedStore')>('../src/lib/plannedStore');
  await renderScreen(<Plan />);
  await chooseDestination();
  await screen.findByText('Fastest');
  await fireEvent.press(screen.getByRole('button', { name: 'Start' }));
  expect(destinationToNavigate()).toBe('Gumdale State School');
});


describe('usability pass', () => {
  const gumdale = { name: 'Gumdale State School', description: 'School', location: [153.15, -27.49] as [number, number] };

  it('finds the trip still planned on coming back to the app, and keeps the one chosen (U2)', async () => {
    mockLastPlan = { to: gumdale, mode: 'foot', at: Date.now() };
    await renderScreen(<Plan />);
    await waitFor(() => expect(screen.getByLabelText('Destination')).toHaveDisplayValue('Gumdale State School'));
    await waitFor(() => expect(fake.api.callsTo('POST api/routes/explore').at(-1)!.body).toMatchObject({ to: [153.15, -27.49], mode: 'foot' }));
    expect(mockSaved.at(-1)).toMatchObject({ to: gumdale, mode: 'foot' });
  });

  it('goes back to where you are when the destination is cleared (U3)', async () => {
    await renderScreen(<Plan />);
    await chooseDestination();
    await screen.findByText('Fastest');
    await fireEvent.press(screen.getByRole('button', { name: 'Clear destination' }));
    expect(fake.map.flyTo).toHaveBeenCalledWith([153.02, -27.47], CLEARED_ZOOM);
    expect(mockSaved.at(-1)).toMatchObject({ to: null });
  });

  it('lists the other ways quickest first, labels each line with its time, and puts them before the controls (U5, U6, U7)', async () => {
    const slow = fromHere({ id: 'r-slow', kind: 'explore', durationS: 1680, extraDurationS: 1020 });
    const quick = fromHere({ id: 'r-quick', kind: 'explore', durationS: 1440, extraDurationS: 780 });
    fake.api.on({ 'POST api/routes/explore': () => ({ fastest: fromHere({ durationS: 660 }), explore: [slow, quick] }) });
    await renderScreen(<Plan />);
    await chooseDestination();
    await screen.findByText('Fastest');
    expect((fake.map.props.routes as Array<{ id: string }>).map((r) => r.id)).toEqual(['r-fast', 'r-quick', 'r-slow']);
    expect(fake.map.props.routeLabels).toEqual({ 'r-fast': '11 min', 'r-quick': '24 min', 'r-slow': '28 min' });
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('24 min')).toBeLessThan(tree.indexOf('28 min'));
    expect(tree.indexOf('Fastest')).toBeLessThan(tree.indexOf('Travel mode'));
  });

  it('fits the routes again when the map changes size, so they aren’t left cut off (U1)', async () => {
    await renderScreen(<Plan />);
    await chooseDestination();
    await screen.findByText('Fastest');
    const fits = fake.map.fitTo.mock.calls.length;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      await fireEvent(screen.getByTestId('map-area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 300 } } });
      await act(async () => void jest.advanceTimersByTime(100));
    } finally {
      jest.useRealTimers();
    }
    expect(fake.map.fitTo.mock.calls.length).toBe(fits + 1);
  });
});
