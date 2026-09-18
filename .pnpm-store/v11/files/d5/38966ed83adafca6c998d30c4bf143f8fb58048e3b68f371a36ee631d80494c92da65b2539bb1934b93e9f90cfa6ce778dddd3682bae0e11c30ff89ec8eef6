"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.validateOptions = validateOptions;
var _errors = require("./errors");
var _logger = require("./logger");
/**
 * Validates that no unknown options are passed to a function.
 * Logs a warning if unknown options are found.
 *
 * @param functionName - The name of the function being called (for error messages)
 * @param restOptions - The rest object from destructuring that contains unknown options
 * @param callsite - The function where the validation is called from (e.g., render, renderHook)
 */
function validateOptions(functionName, restOptions,
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
callsite) {
  const unknownKeys = Object.keys(restOptions);
  if (unknownKeys.length > 0) {
    // Pass the callsite function (e.g., render) to remove it from stack
    // This leaves only where the user called the function from (e.g., test file)
    const stackTraceError = new _errors.ErrorWithStack('STACK_TRACE_ERROR', callsite);
    const stackLines = stackTraceError.stack ? stackTraceError.stack.split('\n') : [];
    // Skip the first line (Error: STACK_TRACE_ERROR) to show the actual call sites
    // The remaining lines show where the user called the function from
    const stackTrace = stackLines.length > 1 ? `\n\n${stackLines.slice(1).join('\n')}` : '';
    _logger.logger.warn(`Unknown option(s) passed to ${functionName}: ${unknownKeys.join(', ')}${stackTrace}`);
  }
}
//# sourceMappingURL=validate-options.js.map