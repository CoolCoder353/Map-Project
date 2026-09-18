"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.testGateReact19_2 = void 0;
var _react = _interopRequireDefault(require("react"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const testRendererVersion = require('test-renderer/package.json').version;
function isVersionAtLeast(versionString, targetMajor, targetMinor, targetPatch) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(versionString);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major !== targetMajor) {
    return major > targetMajor;
  }
  if (minor !== targetMinor) {
    return minor > targetMinor;
  }
  return patch >= targetPatch;
}
const testGateReact19_2 = exports.testGateReact19_2 = isVersionAtLeast(_react.default.version, 19, 2, 0) && isVersionAtLeast(testRendererVersion, 1, 2, 0) ? test : test.skip;
//# sourceMappingURL=react-version-gates.js.map