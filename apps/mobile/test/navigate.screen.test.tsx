/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';
import Navigate from '../app/navigate';
import { setRouteToNavigate } from '../src/lib/plannedStore';
import { fake, renderScreen, resetFakes, route } from './fakes';

jest.mock('expo-router', () => require('./fakes').routerModule);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/map/MapCanvas', () => require('./fakes').mapCanvasModule);
const mockNav = {
  route: null as unknown,
  state: null as unknown,
  rerouting: false,
  error: null as string | null,
  muted: false,
  setMuted: jest.fn(),
  position: null,
  speedMps: null as number | null,
  travelled: [] as unknown[],
  ended: false,
  stop: jest.fn(),
};
jest.mock('../src/nav/useTurnByTurn', () => ({ useTurnByTurn: () => mockNav }));
jest.mock('../src/lib/plannedStore', () => {
  let r: unknown = null;
  return { setRouteToNavigate: (x: unknown) => (r = x), takeRouteToNavigate: () => r };
});

beforeEach(() => {
  resetFakes();
  Object.assign(mockNav, { route: route(), state: null, rerouting: false, error: null, muted: false, speedMps: null, travelled: [], ended: false });
  setRouteToNavigate(route());
});

it('says when there is no route to follow', async () => {
  setRouteToNavigate(null as never);
  await renderScreen(<Navigate />);
  expect(screen.getByText('No route selected.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  expect(fake.router.back).toHaveBeenCalled();
});

it('follows a trip already running when opened to resume it', async () => {
  setRouteToNavigate(null as never);
  fake.params = { resume: '1' };
  await renderScreen(<Navigate />);
  expect(screen.queryByText('No route selected.')).toBeNull();
  expect(screen.getByRole('button', { name: 'End' })).toBeOnTheScreen();
});

it('says there is no route when asked to resume but nothing is running', async () => {
  setRouteToNavigate(null as never);
  fake.params = { resume: '1' };
  mockNav.route = null;
  await renderScreen(<Navigate />);
  expect(screen.getByText('No route selected.')).toBeOnTheScreen();
});

it('goes to Plan when there is nothing to go back to', async () => {
  fake.router.canGoBack.mockReturnValueOnce(false);
  await renderScreen(<Navigate />);
  await fireEvent.press(screen.getByRole('button', { name: 'End' }));
  expect(mockNav.stop).toHaveBeenCalled();
  expect(fake.router.replace).toHaveBeenCalledWith('/plan');
  expect(fake.router.back).not.toHaveBeenCalled();
});

it('waits for a position, then shows the next turn, distance and time left', async () => {
  const { rerender } = await renderScreen(<Navigate />);
  expect(screen.getByText('Getting your location…')).toBeOnTheScreen();
  // Follows you close up; fitting the whole route would zoom out of the drive.
  expect(fake.map.props.followUser).toBe(true);
  expect(fake.map.fitTo).not.toHaveBeenCalled();
  mockNav.state = { status: 'navigating', nextInstruction: { sign: -2, text: 'Turn left onto Logan Road' }, distanceToNextManeuverM: 180, remainingDurationS: 600, remainingDistanceM: 5400 };
  await rerender(<Navigate />);
  expect(screen.getByText('Turn left onto Logan Road')).toBeOnTheScreen();
  expect(screen.getByText('180 m')).toBeOnTheScreen();
  expect(screen.getByText('10 min')).toBeOnTheScreen();
  expect(screen.getByText('5.4 km to go')).toBeOnTheScreen();
});

it('says when you’ll arrive, by the clock', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-28T09:00:00Z'));
  mockNav.state = { status: 'navigating', nextInstruction: { sign: 0, text: 'Continue' }, distanceToNextManeuverM: 900, remainingDurationS: 600, remainingDistanceM: 5400 };
  await renderScreen(<Navigate />);
  // Ten minutes on, in the phone's own time zone.
  expect(screen.getByText(/^Arrive \d{1,2}:10 (am|pm)$/)).toBeOnTheScreen();
  jest.restoreAllMocks();
});

it('shows the turn after the next when it comes straight after, as the car does', async () => {
  const instructions = [
    { sign: 0, text: 'Head north', streetName: '', distanceM: 300, durationS: 30, interval: [0, 1] as [number, number] },
    { sign: -2, text: 'Turn left onto Logan Road', streetName: 'Logan Road', distanceM: 80, durationS: 10, interval: [1, 1] as [number, number] },
    { sign: 2, text: 'Turn right onto Old Cleveland Road', streetName: 'Old Cleveland Road', distanceM: 900, durationS: 60, interval: [1, 1] as [number, number] },
    { sign: 4, text: 'Arrive at destination', streetName: '', distanceM: 0, durationS: 0, interval: [1, 1] as [number, number] },
  ];
  mockNav.route = route({ instructions });
  mockNav.state = { status: 'navigating', nextInstruction: instructions[1], nextInstructionIndex: 1, distanceToNextManeuverM: 180, remainingDurationS: 600, remainingDistanceM: 5400 };
  const { rerender } = await renderScreen(<Navigate />);
  expect(screen.getByLabelText('Then turn right onto Old Cleveland Road')).toBeOnTheScreen();
  // The one after that is 900 m on: nothing to warn about yet.
  mockNav.state = { ...(mockNav.state as object), nextInstruction: instructions[2], nextInstructionIndex: 2 };
  await rerender(<Navigate />);
  expect(screen.queryByLabelText(/^Then /)).toBeNull();
});

it('shows how fast you’re going while driving, marked when over the limit', async () => {
  mockNav.state = { status: 'navigating', nextInstruction: { sign: 0, text: 'Continue' }, distanceToNextManeuverM: 900, remainingDurationS: 600, remainingDistanceM: 5400, speedLimitKmh: 60 };
  mockNav.speedMps = 16.7; // 60 km/h
  const { rerender } = await renderScreen(<Navigate />);
  expect(screen.getByLabelText('Your speed 60 km/h')).toBeOnTheScreen();
  mockNav.speedMps = 18.1; // 65 km/h
  await rerender(<Navigate />);
  expect(screen.getByLabelText('Your speed 65 km/h, over the limit')).toBeOnTheScreen();
  // Not known: nothing, rather than 0.
  mockNav.speedMps = null;
  await rerender(<Navigate />);
  expect(screen.queryByLabelText(/^Your speed/)).toBeNull();
  // On foot it's only distraction.
  mockNav.speedMps = 1.4;
  mockNav.route = route({ mode: 'foot' });
  await rerender(<Navigate />);
  expect(screen.queryByLabelText(/^Your speed/)).toBeNull();
});

it('keeps following you, zoomed in, when a new route arrives', async () => {
  const { rerender } = await renderScreen(<Navigate />);
  mockNav.route = route({ id: 'r-new', geometry: [[153.1, -27.5], [153.2, -27.6]] });
  await rerender(<Navigate />);
  expect(fake.map.props.selectedRouteId).toBe('r-new');
  expect(fake.map.props.followUser).toBe(true);
  expect(fake.map.fitTo).not.toHaveBeenCalled();
  expect(fake.map.flyTo).not.toHaveBeenCalled();
});

it('warns when off route or rerouting, and shows errors', async () => {
  mockNav.state = { status: 'offRoute', currentInstruction: { sign: 0, text: 'Continue' }, remainingDurationS: 60, remainingDistanceM: 500 };
  const { rerender } = await renderScreen(<Navigate />);
  expect(screen.getByText('Off route')).toBeOnTheScreen();
  mockNav.rerouting = true;
  mockNav.error = 'Couldn’t get a new route.';
  await rerender(<Navigate />);
  expect(screen.getByText('Finding a new route…')).toBeOnTheScreen();
  expect(screen.queryByText('Off route')).toBeNull();
  expect(screen.getByText('Couldn’t get a new route.')).toBeOnTheScreen();
});

it('mutes the voice and ends navigation', async () => {
  await renderScreen(<Navigate />);
  await fireEvent.press(screen.getByRole('button', { name: 'Mute voice' }));
  expect(mockNav.setMuted).toHaveBeenCalledWith(true);
  await fireEvent.press(screen.getByRole('button', { name: 'End' }));
  expect(mockNav.stop).toHaveBeenCalled();
  expect(fake.router.back).toHaveBeenCalled();
});

it('says you have arrived and offers Done', async () => {
  mockNav.state = { status: 'arrived', nextInstruction: { sign: 4, text: 'Arrive' }, distanceToNextManeuverM: 0, remainingDurationS: 0, remainingDistanceM: 0 };
  mockNav.muted = true;
  await renderScreen(<Navigate />);
  expect(screen.getByText('You’ve arrived')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Unmute voice' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(fake.router.back).toHaveBeenCalled();
});

it('shows the speed limit of the road you are on, when it is known', async () => {
  const { rerender } = await renderScreen(<Navigate />);
  mockNav.state = { status: 'navigating', nextInstruction: { sign: 0, text: 'Continue' }, distanceToNextManeuverM: 900, remainingDurationS: 600, remainingDistanceM: 5400, speedLimitKmh: 60 };
  await rerender(<Navigate />);
  expect(screen.getByLabelText('Speed limit 60 km/h')).toBeOnTheScreen();
  expect(screen.getByText('60')).toBeOnTheScreen();
  mockNav.state = { ...(mockNav.state as object), speedLimitKmh: null };
  await rerender(<Navigate />);
  expect(screen.queryByLabelText(/Speed limit/)).toBeNull();
  // Off route, the road you are on isn't the route's: no limit rather than a wrong one.
  mockNav.state = { ...(mockNav.state as object), status: 'offRoute', speedLimitKmh: 80 };
  await rerender(<Navigate />);
  expect(screen.queryByLabelText(/Speed limit/)).toBeNull();
});

it('draws the road already driven, off the route too, once there is some', async () => {
  await renderScreen(<Navigate />);
  expect(fake.map.props.track).toBeNull();
  mockNav.travelled = [[153, -27.4], [153.001, -27.4]];
  await renderScreen(<Navigate />);
  expect(fake.map.props.track).toEqual([[153, -27.4], [153.001, -27.4]]);
});

it('closes by itself when the trip ends without it (arrived, or ended in the car)', async () => {
  mockNav.ended = true;
  await renderScreen(<Navigate />);
  expect(fake.router.back).toHaveBeenCalled();
  expect(mockNav.stop).not.toHaveBeenCalled();
});

it('goes back once on End, though the trip then reads as ended', async () => {
  // The same screen re-rendered (renderScreen's rerender would wrap it afresh and remount it).
  const view = await render(<Navigate />);
  await fireEvent.press(screen.getByRole('button', { name: 'End' }));
  mockNav.ended = true;
  await view.rerender(<Navigate />);
  expect(fake.router.back).toHaveBeenCalledTimes(1);
});
