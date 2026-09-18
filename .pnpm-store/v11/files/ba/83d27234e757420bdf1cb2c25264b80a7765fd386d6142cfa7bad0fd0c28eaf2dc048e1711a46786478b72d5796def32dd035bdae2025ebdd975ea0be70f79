"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toBeEmptyElement = toBeEmptyElement;
var _jestMatcherUtils = require("jest-matcher-utils");
var _redent = _interopRequireDefault(require("redent"));
var _componentTree = require("../helpers/component-tree");
var _formatElement = require("../helpers/format-element");
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function toBeEmptyElement(instance) {
  (0, _utils.checkHostElement)(instance, toBeEmptyElement, this);

  // TODO check
  const children = instance.children.filter(child => (0, _componentTree.isTestInstance)(child));
  return {
    pass: children.length === 0,
    message: () => {
      return [(0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toBeEmptyElement`, 'instance', ''), '', 'Received:', `${(0, _jestMatcherUtils.RECEIVED_COLOR)((0, _redent.default)((0, _formatElement.formatElementList)(children), 2))}`].join('\n');
    }
  };
}
//# sourceMappingURL=to-be-empty-element.js.map