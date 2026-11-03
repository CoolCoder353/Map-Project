import { AppRegistry } from 'react-native';
import { native } from '../../modules/wayfinder-car';

const TASK = 'WayfinderKeepTimers';

export interface TimerHold {
  hold(reason: string): void;
  release(reason: string): void;
}

/**
 * React Native runs setTimeout and setInterval only while an app screen is showing or a headless
 * task is running, and a trip or the car can go on with no screen: locked, or started from the car.
 * So while something needs them, a task stays running. It does no work: it ends when its promise
 * resolves. Asking for it can fail without harm, as things then behave as they would without it.
 */
export function createTimerHold(startTask: () => void, register: (task: () => Promise<void>) => void): TimerHold {
  const reasons = new Set<string>();
  let running = false;
  let finish: (() => void) | null = null;
  const end = () => {
    running = false;
    const done = finish;
    finish = null;
    done?.();
  };
  register(() => new Promise((resolve) => {
    finish = resolve;
    // All released before the task got here.
    if (reasons.size === 0) end();
  }));
  return {
    hold(reason) {
      reasons.add(reason);
      if (running) return;
      running = true;
      try {
        startTask();
      } catch {
        running = false;
      }
    },
    release(reason) {
      reasons.delete(reason);
      if (reasons.size === 0 && finish) end();
    },
  };
}

export const timerHold = createTimerHold(
  () => native?.keepTimersRunning(),
  (task) => AppRegistry.registerHeadlessTask(TASK, () => task),
);
