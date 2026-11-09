/// <reference types="jest" />
import { act, fireEvent, screen } from '@testing-library/react-native';
import { endedSummary, NavigatingBanner } from '../src/ui/NavigatingBanner';
import { fake, renderScreen, resetFakes, route } from './fakes';

jest.mock('expo-router', () => require('./fakes').routerModule);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
type Ended = { route: unknown; destinationName: string | null; arrived: boolean; distanceM: number; durationS: number; at: number };
let mockSnap = { active: false, destinationName: null as string | null, ended: null as Ended | null };
const mockListeners = new Set<() => void>();
const mockStart = jest.fn();
const mockDismiss = jest.fn();
jest.mock('../src/nav/navigationService', () => ({
  NOTHING_RECORDED_M: 100,
  navigation: {
    getSnapshot: () => mockSnap,
    subscribe: (l: () => void) => (mockListeners.add(l), () => mockListeners.delete(l)),
    start: (...a: unknown[]) => mockStart(...a),
    dismissEnded: () => mockDismiss(),
  },
}));

beforeEach(() => {
  resetFakes();
  mockStart.mockClear();
  mockDismiss.mockClear();
  mockSnap = { active: false, destinationName: null, ended: null };
});

it('shows nothing without a trip', async () => {
  await renderScreen(<NavigatingBanner />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('appears when a trip starts (from the car, say) and opens the directions', async () => {
  await renderScreen(<NavigatingBanner />);
  await act(async () => {
    mockSnap = { active: true, destinationName: 'Mt Coot-tha Lookout', ended: null };
    mockListeners.forEach((l) => l());
  });
  expect(screen.getByText('Navigating to Mt Coot-tha Lookout')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to directions' }));
  expect(fake.router.push).toHaveBeenCalledWith('/navigate?resume=1');
});

// What a trip came to (P23), a way to pick it up again (P63), and why one left nothing (P97).
it('sums up a trip that ended, and can resume it or be closed', async () => {
  const r = route();
  mockSnap = { active: false, destinationName: null, ended: { route: r, destinationName: 'Coot-tha Place', arrived: false, distanceM: 12_300, durationS: 1080, at: Date.now() } };
  await renderScreen(<NavigatingBanner />);
  expect(screen.getByText('Trip to Coot-tha Place ended: 12 km in 18 min. It’s in Trips once it has uploaded.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Resume directions to Coot-tha Place' }));
  expect(mockStart).toHaveBeenCalledWith(r, expect.objectContaining({ destinationName: 'Coot-tha Place' }));
  expect(fake.router.push).toHaveBeenCalledWith('/navigate?resume=1');
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(mockDismiss).toHaveBeenCalled();
});

it('says when a trip moved too little to be kept, and goes after a while', () => {
  const ended = { route: route(), destinationName: null, arrived: true, distanceM: 20, durationS: 60, at: 0 };
  expect(endedSummary(ended as never)).toBe('Arrived. You hadn’t moved, so nothing was added to Trips.');
});
