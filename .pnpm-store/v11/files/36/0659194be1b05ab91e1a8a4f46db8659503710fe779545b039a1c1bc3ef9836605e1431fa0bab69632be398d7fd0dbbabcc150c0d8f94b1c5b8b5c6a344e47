"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toBeOnTheScreen = toBeOnTheScreen;
var _jestMatcherUtils = require("jest-matcher-utils");
var _redent = _interopRequireDefault(require("redent"));
var _componentTree = require("../helpers/component-tree");
var _formatElement = require("../helpers/format-element");
var _screen = require("../screen");
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function toBeOnTheScreen(instance) {
  if (instance !== null || !this.isNot) {
    (0, _utils.checkHostElement)(instance, toBeOnTheScreen, this);
  }
  const pass = instance === null ? false : _screen.screen.container === (0, _componentTree.getContainerInstance)(instance);
  const errorFound = () => {
    return `expected instance tree not to contain instance, but found\n${(0, _redent.default)((0, _formatElement.formatElement)(instance), 2)}`;
  };
  const errorNotFound = () => {
    return `instance could not be found in the instance tree`;
  };
  return {
    pass,
    message: () => {
      return [(0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toBeOnTheScreen`, 'instance', ''), '', (0, _jestMatcherUtils.RECEIVED_COLOR)(this.isNot ? errorFound() : errorNotFound())].join('\n');
    }
  };
}
//# sourceMappingURL=to-be-on-the-screen.js.map