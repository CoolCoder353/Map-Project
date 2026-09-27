/// <reference types="jest" />
import { fireEvent, screen } from '@testing-library/react-native';
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
  stop: jest.fn(),
};
jest.mock('../src/nav/useTurnByTurn', () => ({ useTurnByTurn: () => mockNav }));
jest.mock('../src/lib/plannedStore', () => {
  let r: unknown = null;
  return { setRouteToNavigate: (x: unknown) => (r = x), takeRouteToNavigate: () => r };
});

beforeEach(() => {
  resetFakes();
  Object.assign(mockNav, { route: route(), state: null, rerouting: false, error: null, muted: false });
  setRouteToNavigate(route());
});

it('says when there is no route to follow', async () => {
  setRouteToNavigate(null as never);
  await renderScreen(<Navigate />);
  expect(screen.getByText('No route selected.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  expect(fake.router.back).toHaveBeenCalled();
});

it('waits for a position, then shows the next turn, distance and time left', async () => {
  const { rerender } = await renderScreen(<Navigate />);
  expect(screen.getByText('Getting your location…')).toBeOnTheScreen();
  expect(fake.map.fitTo).toHaveBeenCalledWith(route().geometry);
  expect(fake.map.props.followUser).toBe(true);
  mockNav.state = { status: 'navigating', nextInstruction: { sign: -2, text: 'Turn left onto Logan Road' }, distanceToNextManeuverM: 180, remainingDurationS: 600, remainingDistanceM: 5400 };
  await rerender(<Navigate />);
  expect(screen.getByText('Turn left onto Logan Road')).toBeOnTheScreen();
  expect(screen.getByText('180 m')).toBeOnTheScreen();
  expect(screen.getByText('10 min')).toBeOnTheScreen();
  expect(screen.getByText('5.4 km to go')).toBeOnTheScreen();
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
