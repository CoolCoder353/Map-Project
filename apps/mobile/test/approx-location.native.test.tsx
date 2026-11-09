/// <reference types="jest" />
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { MOVED_M, useApproxLocation } from '../src/lib/useApproxLocation';

let mockOnMove: ((loc: unknown) => void) | null = null;
const mockRemove = jest.fn();
const at = (lon: number, lat: number) => ({ coords: { longitude: lon, latitude: lat } });
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: { longitude: 153.25, latitude: -27.52 } })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { longitude: 153.0251, latitude: -27.4698 } })),
  watchPositionAsync: jest.fn(async (_o: unknown, cb: (loc: unknown) => void) => {
    mockOnMove = cb;
    return { remove: mockRemove };
  }),
}));

beforeEach(() => {
  mockOnMove = null;
  mockRemove.mockClear();
});

it('starts from the last known position, then where the phone is now, and follows it as it moves', async () => {
  const { result, unmount } = await renderHook(() => useApproxLocation());
  await waitFor(() => expect(result.current).toEqual([153.0251, -27.4698]));
  await waitFor(() => expect(mockOnMove).not.toBeNull());
  expect(Location.watchPositionAsync).toHaveBeenCalledWith(expect.objectContaining({ distanceInterval: MOVED_M }), expect.any(Function));
  // A wobble of a few metres changes nothing.
  await act(async () => mockOnMove!(at(153.0252, -27.4698)));
  expect(result.current).toEqual([153.0251, -27.4698]);
  await act(async () => mockOnMove!(at(152.957, -27.4846)));
  expect(result.current).toEqual([152.957, -27.4846]);
  await unmount();
  expect(mockRemove).toHaveBeenCalled();
});

it('never asks for permission, and has no position without it', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  const { result } = await renderHook(() => useApproxLocation());
  await act(async () => undefined);
  expect(result.current).toBeUndefined();
});
