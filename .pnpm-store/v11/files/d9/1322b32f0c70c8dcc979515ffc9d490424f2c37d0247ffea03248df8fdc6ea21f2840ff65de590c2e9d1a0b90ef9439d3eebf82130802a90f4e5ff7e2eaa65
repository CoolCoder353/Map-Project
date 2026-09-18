"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.debug = debug;
var _formatElement = require("./format-element");
var _logger = require("./logger");
/**
 * Log pretty-printed deep test component instance
 */
function debug(node, {
  message,
  ...formatOptions
} = {}) {
  if (message) {
    _logger.logger.info(`${message}\n\n`, (0, _formatElement.formatJson)(node, formatOptions));
  } else {
    _logger.logger.info((0, _formatElement.formatJson)(node, formatOptions));
  }
}
//# sourceMappingURL=debug.js.map