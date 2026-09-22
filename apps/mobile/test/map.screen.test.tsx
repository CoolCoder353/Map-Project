/// <reference types="jest" />
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { MapErrorBoundary } from '../src/map/MapErrorBoundary';

const Boom = (): never => {
  throw new Error('native map exploded');
};

it('keeps the app alive when the map fails, and says what happened', async () => {
  // React logs the error it recovered from; that is expected here.
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await render(
    <MapErrorBoundary>
      <Boom />
    </MapErrorBoundary>,
  );
  expect(screen.getByText(/The map could not be shown/)).toBeOnTheScreen();
  expect(screen.getByText('native map exploded')).toBeOnTheScreen();
  spy.mockRestore();
});

it('shows its children when nothing goes wrong', async () => {
  await render(
    <MapErrorBoundary>
      <Text>the map</Text>
    </MapErrorBoundary>,
  );
  expect(screen.getByText('the map')).toBeOnTheScreen();
});
