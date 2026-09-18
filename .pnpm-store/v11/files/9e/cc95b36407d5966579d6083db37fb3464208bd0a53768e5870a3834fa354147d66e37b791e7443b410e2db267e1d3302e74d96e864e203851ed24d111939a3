"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toBeCollapsed = toBeCollapsed;
exports.toBeExpanded = toBeExpanded;
var _jestMatcherUtils = require("jest-matcher-utils");
var _redent = _interopRequireDefault(require("redent"));
var _accessibility = require("../helpers/accessibility");
var _formatElement = require("../helpers/format-element");
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function toBeExpanded(instance) {
  (0, _utils.checkHostElement)(instance, toBeExpanded, this);
  return {
    pass: (0, _accessibility.computeAriaExpanded)(instance) === true,
    message: () => {
      const matcher = (0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toBeExpanded`, 'instance', '');
      return [matcher, '', `Received instance is ${this.isNot ? '' : 'not '}expanded:`, (0, _redent.default)((0, _formatElement.formatElement)(instance), 2)].join('\n');
    }
  };
}
function toBeCollapsed(instance) {
  (0, _utils.checkHostElement)(instance, toBeCollapsed, this);
  return {
    pass: (0, _accessibility.computeAriaExpanded)(instance) === false,
    message: () => {
      const matcher = (0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toBeCollapsed`, 'instance', '');
      return [matcher, '', `Received instance is ${this.isNot ? '' : 'not '}collapsed:`, (0, _redent.default)((0, _formatElement.formatElement)(instance), 2)].join('\n');
    }
  };
}
//# sourceMappingURL=to-be-expanded.js.map