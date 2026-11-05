/// <reference types="jest" />
import { createTimerHold } from '../src/lib/keepTimers';

jest.mock('react-native', () => ({ AppRegistry: { registerHeadlessTask: jest.fn() } }));
jest.mock('../modules/wayfinder-car', () => ({ native: null }));

/** The task as React Native runs it: [run] starts one, and [ended] is how many have finished. */
function setup() {
  let task: () => Promise<void> = async () => undefined;
  const started = jest.fn();
  const hold = createTimerHold(started, (t) => void (task = t));
  let ended = 0;
  const run = () => task().then(() => void ended++);
  return { hold, started, run, ended: () => ended };
}
const settled = () => new Promise((r) => setImmediate(r));

it('runs one task however many things need the timers, until the last lets go', async () => {
  const { hold, started, run, ended } = setup();
  hold.hold('trip');
  hold.hold('car');
  expect(started).toHaveBeenCalledTimes(1);
  void run();
  hold.release('trip');
  await settled();
  expect(ended()).toBe(0);
  hold.release('car');
  await settled();
  expect(ended()).toBe(1);
});

it('starts again after ending', async () => {
  const { hold, started, run } = setup();
  hold.hold('trip');
  void run();
  hold.release('trip');
  await settled();
  hold.hold('trip');
  expect(started).toHaveBeenCalledTimes(2);
});

it('a task that starts after everything let go ends at once, and can be started again', async () => {
  const { hold, started, run, ended } = setup();
  hold.hold('trip');
  hold.release('trip');
  void run();
  await settled();
  expect(ended()).toBe(1);
  hold.hold('trip');
  expect(started).toHaveBeenCalledTimes(2);
});

it('held again before a slow task starts: the one task serves', async () => {
  const { hold, started, run, ended } = setup();
  hold.hold('trip');
  hold.release('trip');
  hold.hold('car');
  void run();
  await settled();
  expect(started).toHaveBeenCalledTimes(1);
  expect(ended()).toBe(0);
});

it('survives the task failing to start, and tries again next time', () => {
  let task: () => Promise<void> = async () => undefined;
  const started = jest.fn(() => { throw new Error('no React instance'); });
  const hold = createTimerHold(started, (t) => void (task = t));
  expect(() => hold.hold('trip')).not.toThrow();
  hold.hold('car');
  expect(started).toHaveBeenCalledTimes(2);
  expect(task).toBeDefined();
});
