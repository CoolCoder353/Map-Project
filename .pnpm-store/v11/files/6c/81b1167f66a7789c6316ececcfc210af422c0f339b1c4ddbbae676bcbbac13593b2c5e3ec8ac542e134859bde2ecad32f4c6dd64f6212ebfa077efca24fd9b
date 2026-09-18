"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.addToCleanupQueue = addToCleanupQueue;
exports.cleanup = cleanup;
exports.removeFromCleanupQueue = removeFromCleanupQueue;
var _screen = require("./screen");
const cleanupQueue = new Set();
async function cleanup() {
  (0, _screen.clearRenderResult)();
  for (const fn of cleanupQueue) {
    await fn();
  }
  cleanupQueue.clear();
}
function addToCleanupQueue(fn) {
  cleanupQueue.add(fn);
}
function removeFromCleanupQueue(fn) {
  cleanupQueue.delete(fn);
}
//# sourceMappingURL=cleanup.js.map