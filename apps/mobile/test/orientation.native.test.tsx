/** Phones are held upright at runtime; large windows turn freely (the manifest holds no lock). */
/// <reference types="jest" />
import { render } from '@testing-library/react-native';
import { useOrientationPolicy } from '../src/lib/orientation';
import { WINDOWS, resetFakes, resizeWindow, windowSize } from './fakes';

const mockLock = jest.fn(async (..._a: unknown[]) => undefined);
const mockUnlock = jest.fn(async () => undefined);
jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { PORTRAIT_UP: 3 },
  lockAsync: (...a: unknown[]) => mockLock(...a),
  unlockAsync: () => mockUnlock(),
}));

function Probe() {
  useOrientationPolicy();
  return null;
}

beforeEach(() => {
  resetFakes();
  mockLock.mockClear();
  mockUnlock.mockClear();
});

it('locks a phone to portrait', async () => {
  await render(<Probe />);
  expect(mockLock).toHaveBeenCalledWith(3);
  expect(mockUnlock).not.toHaveBeenCalled();
});

it.each([['a 600 dp window', WINDOWS.medium], ['a foldable', WINDOWS.foldable], ['a tablet', WINDOWS.tablet]])('leaves %s free to turn', async (_n, size) => {
  windowSize(size.width, size.height);
  await render(<Probe />);
  expect(mockUnlock).toHaveBeenCalled();
  expect(mockLock).not.toHaveBeenCalled();
});

it('follows the window as it grows past 600 dp and shrinks again', async () => {
  await render(<Probe />);
  await resizeWindow(WINDOWS.tablet.width, WINDOWS.tablet.height);
  expect(mockUnlock).toHaveBeenCalledTimes(1);
  await resizeWindow(WINDOWS.phone.width, WINDOWS.phone.height);
  expect(mockLock).toHaveBeenCalledTimes(2);
});

it('does not mind a device that refuses the lock', async () => {
  mockLock.mockRejectedValueOnce(new Error('unsupported'));
  await render(<Probe />);
  expect(mockLock).toHaveBeenCalled();
});
