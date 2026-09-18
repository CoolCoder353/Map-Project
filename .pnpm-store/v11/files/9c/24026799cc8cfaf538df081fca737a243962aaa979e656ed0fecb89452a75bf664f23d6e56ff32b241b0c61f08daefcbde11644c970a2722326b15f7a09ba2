"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ErrorWithStack = void 0;
exports.copyStackTraceIfNeeded = copyStackTraceIfNeeded;
class ErrorWithStack extends Error {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  constructor(message, callsite) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, callsite);
    }
  }
}
exports.ErrorWithStack = ErrorWithStack;
function copyStackTraceIfNeeded(target, stackTraceSource) {
  if (stackTraceSource != null && target instanceof Error && stackTraceSource.stack) {
    target.stack = stackTraceSource.stack.replace(stackTraceSource.message, target.message);
  }
}
//# sourceMappingURL=errors.js.map