/// <reference types="jest" />
import { waitFor } from '@testing-library/react-native';
import { startCarController } from '../src/car/controller';
import { fakeCarNative } from './fakes';

jest.mock('../src/lib/api', () => require('./fakes').apiModule);

it('tells the car it is listening, then answers', async () => {
  const car = fakeCarNative();
  const stop = startCarController({ echo: async (p) => p }, car as never);
  expect(car.ready).toHaveBeenCalled();
  const id = car.ask('echo', { a: 1 });
  await waitFor(() => expect(car.answerTo(id)).toEqual({ a: 1 }));
  stop();
  car.ask('echo');
  expect(car.resolve).toHaveBeenCalledTimes(1);
});

it('turns a failure into words the car can show', async () => {
  const car = fakeCarNative();
  startCarController({ search: async () => { throw new Error('Can’t reach your server.'); } }, car as never);
  const id = car.ask('search', { q: 'x' });
  await waitFor(() => expect(car.reject).toHaveBeenCalledWith(id, 'Can’t reach your server.'));
});

it('says so when the car asks for something this build doesn’t do', async () => {
  const car = fakeCarNative();
  startCarController({}, car as never);
  const id = car.ask('teleport');
  await waitFor(() => expect(car.reject).toHaveBeenCalledWith(id, expect.stringMatching(/update Wayfinder/)));
});

it('does nothing where there is no car app (Expo Go, tests)', () => {
  expect(startCarController({ echo: async () => 1 }, null)()).toBeUndefined();
});

it('falls back to the real native module when none is given', () => {
  // No car app in Jest (test/setup.ts mocks it to null), so this exercises the default parameter
  // the same way apps/mobile/index.ts calls startCarController(carHandlers) at boot.
  expect(startCarController({ echo: async () => 1 })()).toBeUndefined();
});
