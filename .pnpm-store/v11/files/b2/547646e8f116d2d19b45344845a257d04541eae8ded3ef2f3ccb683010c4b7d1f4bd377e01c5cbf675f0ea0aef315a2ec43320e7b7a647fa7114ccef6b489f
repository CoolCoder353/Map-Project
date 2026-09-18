"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.setupTimeType = setupTimeType;
function setupTimeType(type) {
  if (type === 'fake-legacy') {
    jest.useFakeTimers({
      legacyFakeTimers: true
    });
  } else if (type === 'fake') {
    jest.useFakeTimers({
      legacyFakeTimers: false
    });
  } else {
    jest.useRealTimers();
  }
}
//# sourceMappingURL=timers.js.map