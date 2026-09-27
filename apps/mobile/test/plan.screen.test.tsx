/// <reference types="jest" />
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
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

afterEach(() => expect(fake.api.unhandled).toEqual([]));
