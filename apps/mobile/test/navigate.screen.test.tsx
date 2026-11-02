/// <reference types="jest" />
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
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
  skipDetour: jest.fn(),
  position: null,
  speedMps: null as number | null,
  travelled: [] as unknown[],
  ended: false,
  stop: jest.fn(),
};
jest.mock('../src/nav/useTurnByTurn', () => ({ useTurnByTurn: () => mockNav }));
const mockSend = jest.fn(async (_where: unknown) => 'Thanks. We’ll check the limit here.');
jest.mock('../src/nav/speedLimitReport', () => ({ sendSpeedLimitReport: (where: unknown) => mockSend(where) }));
jest.mock('../src/lib/plannedStore', () => {
  let r: unknown = null;
  return { setRouteToNavigate: (x: unknown) => (r = x), takeRouteToNavigate: () => r };
});

type AlertButtons = Array<{ text?: string; onPress?: () => void }>;

beforeEach(() => {
  resetFakes();
  // Ending a trip asks first: say yes, unless a test says otherwise.
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => (buttons as AlertButtons | undefined)?.find((b) => b.text === 'End trip')?.onPress?.());
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

it('marks the lights ahead while driving, and how much longer while waiting at them', async () => {
  const { rerender } = await renderScreen(<Navigate />);
  const lightsAhead = [{ at: [153.01, -27.4], progressM: 300, state: 'red', waitS: 30 }];
  mockNav.state = { status: 'navigating', nextInstruction: { sign: 0, text: 'Continue' }, distanceToNextManeuverM: 900, remainingDurationS: 600, remainingDistanceM: 5400, speedLimitKmh: null, lightsAhead, lightWait: 'Usually about 20 s more' };
  await rerender(<Navigate />);
  expect(fake.map.props.lights).toBe(lightsAhead);
  expect(screen.getByText('Usually about 20 s more')).toBeOnTheScreen();
  // Off route, the lights ahead are the route's, not the road you're on.
  mockNav.state = { ...(mockNav.state as object), status: 'offRoute', lightWait: null };
  await rerender(<Navigate />);
  expect(fake.map.props.lights).toEqual([]);
  expect(screen.queryByText('Usually about 20 s more')).toBeNull();
});

it('shows a limit that is only the legal default in a grey ring', async () => {
  const { rerender } = await renderScreen(<Navigate />);
  mockNav.state = { status: 'navigating', nextInstruction: { sign: 0, text: 'Continue' }, distanceToNextManeuverM: 900, remainingDurationS: 600, remainingDistanceM: 5400, speedLimitKmh: 50, speedLimitEstimated: true };
  await rerender(<Navigate />);
  expect(screen.getByLabelText('Speed limit probably 50 km/h, no sign mapped')).toHaveStyle({ borderColor: '#8a8f98' });
});

it('reports the limit as wrong when you tap it and say so', async () => {
  jest.useFakeTimers();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    mockNav.state = { status: 'navigating', nextInstruction: { sign: 0, text: 'Continue' }, distanceToNextManeuverM: 900, remainingDurationS: 600, remainingDistanceM: 5400, speedLimitKmh: 60, speedLimitEstimated: false };
    mockNav.position = [153.02, -27.47] as never;
    await renderScreen(<Navigate />);
    await fireEvent.press(screen.getByRole('button', { name: 'Speed limit 60 km/h' }));
    expect(alert.mock.calls[0]![1]).toBe('Report that 60 km/h is wrong here.');
    // Cancel sends nothing; Report does, and says how it went for a few seconds.
    const buttons = alert.mock.calls[0]![2]!;
    expect(buttons[0]).toMatchObject({ text: 'Cancel', style: 'cancel' });
    await act(async () => buttons[1]!.onPress!());
    expect(mockSend).toHaveBeenCalledWith({ state: mockNav.state, position: [153.02, -27.47] });
    expect(screen.getByText('Thanks. We’ll check the limit here.')).toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(5000));
    expect(screen.queryByText('Thanks. We’ll check the limit here.')).toBeNull();
    // With no limit shown, the report is that one is missing.
    mockNav.state = { ...(mockNav.state as object), speedLimitKmh: null };
    mockNav.speedMps = 15;
    await renderScreen(<Navigate />);
    await fireEvent.press(screen.getAllByRole('button', { name: /Your speed/ }).at(-1)!);
    expect(alert.mock.calls.at(-1)![1]).toBe('Report that the limit here is missing.');
  } finally {
    alert.mockRestore();
    mockNav.position = null;
    jest.useRealTimers();
  }
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

it('asks before ending a trip that hasn’t arrived, and ends at once when it has', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockNav.state = { status: 'navigating', nextInstruction: { sign: 0, text: 'Continue' }, distanceToNextManeuverM: 900, remainingDurationS: 600, remainingDistanceM: 5400, speedLimitKmh: null };
  const view = await render(<Navigate />);
  await fireEvent.press(screen.getByRole('button', { name: 'End' }));
  expect(alert.mock.calls[0]![0]).toBe('End this trip?');
  const buttons = alert.mock.calls[0]![2] as AlertButtons;
  // Keep going: nothing stops.
  expect(buttons[0]).toMatchObject({ text: 'Keep going', style: 'cancel' });
  expect(mockNav.stop).not.toHaveBeenCalled();
  await act(async () => buttons.find((b) => b.text === 'End trip')!.onPress!());
  expect(mockNav.stop).toHaveBeenCalledTimes(1);
  // Arrived, Done ends it without asking.
  alert.mockClear();
  mockNav.state = { ...(mockNav.state as object), status: 'arrived' };
  await view.rerender(<Navigate />);
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(alert).not.toHaveBeenCalled();
  expect(mockNav.stop).toHaveBeenCalledTimes(2);
});

it('draws the turn as the car does: keep left as keep left, a roundabout with its exit', async () => {
  mockNav.state = { status: 'navigating', nextInstruction: { sign: -7, text: 'Keep left' }, distanceToNextManeuverM: 300, remainingDurationS: 600, remainingDistanceM: 5400, speedLimitKmh: null };
  const view = await render(<Navigate />);
  // The arrow is hidden from screen readers (the words say the turn), so looked for including hidden ones.
  expect(screen.getByTestId('maneuver-keepLeft', { includeHiddenElements: true })).toBeOnTheScreen();
  mockNav.state = { ...(mockNav.state as object), nextInstruction: { sign: 6, text: 'At roundabout, take exit 2', exitAngleDeg: 175 } };
  await view.rerender(<Navigate />);
  expect(screen.getByTestId('maneuver-roundabout', { includeHiddenElements: true })).toBeOnTheScreen();
});

it('offers to skip an explore route’s detour, and only there', async () => {
  mockNav.route = route({ kind: 'explore' });
  mockNav.state = { status: 'navigating', nextInstruction: { sign: 0, text: 'Continue' }, distanceToNextManeuverM: 900, remainingDurationS: 600, remainingDistanceM: 5400, speedLimitKmh: null };
  const view = await render(<Navigate />);
  await fireEvent.press(screen.getByRole('button', { name: 'Skip the detour' }));
  expect(mockNav.skipDetour).toHaveBeenCalled();
  // Not while a new route is on its way, nor on the fastest route.
  mockNav.rerouting = true;
  await view.rerender(<Navigate />);
  expect(screen.queryByRole('button', { name: 'Skip the detour' })).toBeNull();
  mockNav.rerouting = false;
  mockNav.route = route();
  await view.rerender(<Navigate />);
  expect(screen.queryByRole('button', { name: 'Skip the detour' })).toBeNull();
});

it('goes back once on End, though the trip then reads as ended', async () => {
  // The same screen re-rendered (renderScreen's rerender would wrap it afresh and remount it).
  const view = await render(<Navigate />);
  await fireEvent.press(screen.getByRole('button', { name: 'End' }));
  mockNav.ended = true;
  await view.rerender(<Navigate />);
  expect(fake.router.back).toHaveBeenCalledTimes(1);
});
