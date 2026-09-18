"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toBeDisabled = toBeDisabled;
exports.toBeEnabled = toBeEnabled;
var _jestMatcherUtils = require("jest-matcher-utils");
var _redent = _interopRequireDefault(require("redent"));
var _accessibility = require("../helpers/accessibility");
var _formatElement = require("../helpers/format-element");
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function toBeDisabled(instance) {
  (0, _utils.checkHostElement)(instance, toBeDisabled, this);
  const isDisabled = (0, _accessibility.computeAriaDisabled)(instance) || isAncestorDisabled(instance);
  return {
    pass: isDisabled,
    message: () => {
      const is = this.isNot ? 'is' : 'is not';
      return [(0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toBeDisabled`, 'instance', ''), '', `Received instance ${is} disabled:`, (0, _redent.default)((0, _formatElement.formatElement)(instance), 2)].join('\n');
    }
  };
}
function toBeEnabled(instance) {
  (0, _utils.checkHostElement)(instance, toBeEnabled, this);
  const isEnabled = !(0, _accessibility.computeAriaDisabled)(instance) && !isAncestorDisabled(instance);
  return {
    pass: isEnabled,
    message: () => {
      const is = this.isNot ? 'is' : 'is not';
      return [(0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toBeEnabled`, 'instance', ''), '', `Received instance ${is} enabled:`, (0, _redent.default)((0, _formatElement.formatElement)(instance), 2)].join('\n');
    }
  };
}
function isAncestorDisabled(instance) {
  const parent = instance.parent;
  if (parent == null) {
    return false;
  }
  return (0, _accessibility.computeAriaDisabled)(parent) || isAncestorDisabled(parent);
}
//# sourceMappingURL=to-be-disabled.js.map