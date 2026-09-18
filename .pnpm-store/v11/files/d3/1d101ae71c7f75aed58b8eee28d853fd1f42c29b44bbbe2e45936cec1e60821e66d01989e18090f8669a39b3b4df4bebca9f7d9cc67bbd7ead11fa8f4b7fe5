"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toBePartiallyChecked = toBePartiallyChecked;
var _jestMatcherUtils = require("jest-matcher-utils");
var _redent = _interopRequireDefault(require("redent"));
var _accessibility = require("../helpers/accessibility");
var _errors = require("../helpers/errors");
var _formatElement = require("../helpers/format-element");
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function toBePartiallyChecked(instance) {
  (0, _utils.checkHostElement)(instance, toBePartiallyChecked, this);
  if (!hasValidAccessibilityRole(instance)) {
    throw new _errors.ErrorWithStack('toBePartiallyChecked() works only on accessibility elements with "checkbox" role.', toBePartiallyChecked);
  }
  return {
    pass: (0, _accessibility.computeAriaChecked)(instance) === 'mixed',
    message: () => {
      const is = this.isNot ? 'is' : 'is not';
      return [(0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toBePartiallyChecked`, 'instance', ''), '', `Received instance ${is} partially checked:`, (0, _redent.default)((0, _formatElement.formatElement)(instance), 2)].join('\n');
    }
  };
}
function hasValidAccessibilityRole(instance) {
  const role = (0, _accessibility.getRole)(instance);
  return (0, _accessibility.isAccessibilityElement)(instance) && role === 'checkbox';
}
//# sourceMappingURL=to-be-partially-checked.js.map