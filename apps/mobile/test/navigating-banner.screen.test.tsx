/// <reference types="jest" />
import { act, fireEvent, screen } from '@testing-library/react-native';
import { NavigatingBanner } from '../src/ui/NavigatingBanner';
import { fake, renderScreen, resetFakes } from './fakes';

jest.mock('expo-router', () => require('./fakes').routerModule);
let mockSnap = { active: false, destinationName: null as string | null };
const mockListeners = new Set<() => void>();
jest.mock('../src/nav/navigationService', () => ({
  navigation: { getSnapshot: () => mockSnap, subscribe: (l: () => void) => (mockListeners.add(l), () => mockListeners.delete(l)) },
}));

beforeEach(() => {
  resetFakes();
  mockSnap = { active: false, destinationName: null };
});

it('shows nothing without a trip', async () => {
  await renderScreen(<NavigatingBanner />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('appears when a trip starts (from the car, say) and opens the directions', async () => {
  await renderScreen(<NavigatingBanner />);
  await act(async () => {
    mockSnap = { active: true, destinationName: 'Mt Coot-tha Lookout' };
    mockListeners.forEach((l) => l());
  });
  expect(screen.getByText('Navigating to Mt Coot-tha Lookout')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to directions' }));
  expect(fake.router.push).toHaveBeenCalledWith('/navigate?resume=1');
});
