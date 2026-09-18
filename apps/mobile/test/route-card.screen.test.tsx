/// <reference types="jest" />
import type { Route } from '@wayfinder/shared/schemas';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { RouteCard } from '../src/ui/RouteCard';

jest.mock('../src/lib/api', () => ({ api: { request: jest.fn() } }));

const route = (kind: 'fastest' | 'explore', over: Partial<Route> = {}): Route =>
  ({
    id: kind,
    kind,
    distanceM: 32_400,
    durationS: 29 * 60,
    extraDurationS: kind === 'fastest' ? 0 : 60 * 4,
    geometry: [],
    instructions: [],
    novelty: { newKm: kind === 'fastest' ? 0 : 9.8, noveltyPct: 30, retraceRatio: 0 },
    ...over,
  }) as unknown as Route;

it('shows the fastest route without extra time or a new-ground badge', async () => {
  await render(<RouteCard route={route('fastest')} title="Fastest" selected={false} onSelect={jest.fn()} onStart={jest.fn()} />);
  expect(screen.getByText('Fastest')).toBeOnTheScreen();
  expect(screen.getByText('29 min')).toBeOnTheScreen();
  expect(screen.queryByText(/never been/)).toBeNull();
  expect(screen.queryByText(/^\+/)).toBeNull();
});

it('shows new ground and extra time on an explore route', async () => {
  await render(<RouteCard route={route('explore')} title="Explore 1" selected={false} onSelect={jest.fn()} onStart={jest.fn()} />);
  expect(screen.getByText('9.8 km you’ve never been')).toBeOnTheScreen();
  expect(screen.getByText('+4 min')).toBeOnTheScreen();
});

it('offers Start only once the route is selected', async () => {
  const onSelect = jest.fn();
  const onStart = jest.fn();
  const { rerender } = await render(<RouteCard route={route('explore')} title="Explore 1" selected={false} onSelect={onSelect} onStart={onStart} />);
  expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  await fireEvent.press(screen.getByText('Explore 1'));
  expect(onSelect).toHaveBeenCalled();
  await rerender(<RouteCard route={route('explore')} title="Explore 1" selected onSelect={onSelect} onStart={onStart} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Start' }));
  expect(onStart).toHaveBeenCalled();
});
