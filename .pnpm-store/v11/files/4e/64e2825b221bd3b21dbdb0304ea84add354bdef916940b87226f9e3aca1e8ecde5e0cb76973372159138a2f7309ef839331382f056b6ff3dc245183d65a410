"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.waitFor = waitFor;
var _act = require("./act");
var _cleanup = require("./cleanup");
var _config = require("./config");
var _flushMicroTasks = require("./flush-micro-tasks");
var _errors = require("./helpers/errors");
var _timers = require("./helpers/timers");
var _wrapAsync = require("./helpers/wrap-async");
/* globals jest */

const DEFAULT_INTERVAL = 50;
function waitForInternal(expectation, {
  timeout = (0, _config.getConfig)().asyncUtilTimeout,
  interval = DEFAULT_INTERVAL,
  stackTraceError,
  onTimeout
}) {
  if (typeof expectation !== 'function') {
    throw new TypeError('Received `expectation` arg must be a function');
  }

  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    let lastError;
    let intervalId = null;
    let finished = false;
    let promiseStatus = 'idle';
    let overallTimeoutTimer = null;
    const cleanupQueueCallback = () => finalizeWaitFor({
      rejectOnAbort: true
    });
    const fakeTimersType = (0, _timers.getJestFakeTimersType)();
    if (fakeTimersType) {
      checkExpectation();
      // this is a dangerous rule to disable because it could lead to an
      // infinite loop. However, eslint isn't smart enough to know that we're
      // setting finished inside `onDone` which will be called when we're done
      // waiting or when we've timed out.
      let fakeTimeRemaining = timeout;
      while (!finished) {
        if (!(0, _timers.jestFakeTimersAreEnabled)()) {
          const error = new Error(`Changed from using fake timers to real timers while using waitFor. This is not allowed and will result in very strange behavior. Please ensure you're awaiting all async things your test is doing before changing to real timers. For more info, please go to https://github.com/testing-library/dom-testing-library/issues/830`);
          (0, _errors.copyStackTraceIfNeeded)(error, stackTraceError);
          reject(error);
          return;
        }

        // when fake timers are used we want to simulate the interval time passing
        if (fakeTimeRemaining <= 0) {
          handleTimeout();
          return;
        } else {
          fakeTimeRemaining -= interval;
        }

        // we *could* (maybe should?) use `advanceTimersToNextTimer` but it's
        // possible that could make this loop go on forever if someone is using
        // third party code that's setting up recursive timers so rapidly that
        // the user's timer's don't get a chance to resolve. So we'll advance
        // by an interval instead. (We have a test for this case).
        await (0, _act.act)(() => fakeTimersType === 'modern' ? jest.advanceTimersByTimeAsync(interval) : jest.advanceTimersByTime(interval));

        // It's really important that checkExpectation is run *before* we flush
        // in-flight promises. To be honest, I'm not sure why, and I can't quite
        // think of a way to reproduce the problem in a test, but I spent
        // an entire day banging my head against a wall on this.
        checkExpectation();

        // In this rare case, we *need* to wait for in-flight promises
        // to resolve before continuing. We don't need to take advantage
        // of parallelization so we're fine.
        // https://stackoverflow.com/a/59243586/971592
        await (0, _flushMicroTasks.flushMicroTasks)();
      }
    } else {
      overallTimeoutTimer = (0, _timers.setTimeout)(handleTimeout, timeout);
      intervalId = setInterval(checkRealTimersCallback, interval);
      (0, _cleanup.addToCleanupQueue)(cleanupQueueCallback);
      checkExpectation();
    }
    function finalizeWaitFor({
      rejectOnAbort = false
    } = {}) {
      /* istanbul ignore next */
      if (finished) {
        return;
      }
      finished = true;
      (0, _cleanup.removeFromCleanupQueue)(cleanupQueueCallback);
      if (rejectOnAbort) {
        reject(new Error('waitFor was aborted by cleanup'));
      }
      if (overallTimeoutTimer) {
        (0, _timers.clearTimeout)(overallTimeoutTimer);
        overallTimeoutTimer = null;
      }
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function onDone(done) {
      if (finished) {
        return;
      }
      finalizeWaitFor();
      if (done.type === 'error') {
        reject(done.error);
      } else {
        resolve(done.result);
      }
    }
    function checkRealTimersCallback() {
      if ((0, _timers.jestFakeTimersAreEnabled)()) {
        const error = new Error(`Changed from using real timers to fake timers while using waitFor. This is not allowed and will result in very strange behavior. Please ensure you're awaiting all async things your test is doing before changing to fake timers. For more info, please go to https://github.com/testing-library/dom-testing-library/issues/830`);
        (0, _errors.copyStackTraceIfNeeded)(error, stackTraceError);
        return onDone({
          type: 'error',
          error
        });
      } else {
        return checkExpectation();
      }
    }
    function checkExpectation() {
      /* istanbul ignore next */
      if (promiseStatus === 'pending') {
        return;
      }
      try {
        const result = expectation();

        // @ts-expect-error result can be a promise
        if (typeof result?.then === 'function') {
          const promiseResult = result;
          promiseStatus = 'pending';
          // eslint-disable-next-line promise/catch-or-return, promise/prefer-await-to-then
          promiseResult.then(resolvedValue => {
            promiseStatus = 'resolved';
            onDone({
              type: 'result',
              result: resolvedValue
            });
            return;
          }, rejectedValue => {
            promiseStatus = 'rejected';
            lastError = rejectedValue;
            return;
          });
        } else {
          onDone({
            type: 'result',
            result: result
          });
        }
        // If `callback` throws, wait for the next mutation, interval, or timeout.
      } catch (error) {
        // Save the most recent callback error to reject the promise with it in the event of a timeout
        lastError = error;
      }
    }
    function handleTimeout() {
      let error;
      if (lastError) {
        if (lastError instanceof Error) {
          error = lastError;
        } else {
          error = new Error(String(lastError));
        }
        (0, _errors.copyStackTraceIfNeeded)(error, stackTraceError);
      } else {
        error = new Error('Timed out in waitFor.');
        (0, _errors.copyStackTraceIfNeeded)(error, stackTraceError);
      }
      let errorForRejection = error;
      if (typeof onTimeout === 'function') {
        try {
          const result = onTimeout(error);
          if (result) {
            errorForRejection = result;
          }
        } catch (onTimeoutError) {
          errorForRejection = onTimeoutError;
        }
      }
      onDone({
        type: 'error',
        error: errorForRejection
      });
    }
  });
}
function waitFor(expectation, options) {
  // Being able to display a useful stack trace requires generating it before doing anything async
  const stackTraceError = new _errors.ErrorWithStack('STACK_TRACE_ERROR', waitFor);
  const optionsWithStackTrace = {
    stackTraceError,
    ...options
  };
  return (0, _wrapAsync.wrapAsync)(() => waitForInternal(expectation, optionsWithStackTrace));
}
//# sourceMappingURL=wait-for.js.map