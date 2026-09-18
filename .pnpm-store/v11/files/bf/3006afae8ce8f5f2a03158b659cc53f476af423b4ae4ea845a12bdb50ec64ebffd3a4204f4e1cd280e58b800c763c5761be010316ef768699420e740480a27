"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toBeChecked = toBeChecked;
var _jestMatcherUtils = require("jest-matcher-utils");
var _redent = _interopRequireDefault(require("redent"));
var _accessibility = require("../helpers/accessibility");
var _errors = require("../helpers/errors");
var _formatElement = require("../helpers/format-element");
var _hostComponentNames = require("../helpers/host-component-names");
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function toBeChecked(instance) {
  (0, _utils.checkHostElement)(instance, toBeChecked, this);
  if (!(0, _hostComponentNames.isHostSwitch)(instance) && !isSupportedAccessibilityElement(instance)) {
    throw new _errors.ErrorWithStack(`toBeChecked() works only on host "Switch" instances or accessible instance with "checkbox", "radio" or "switch" role.`, toBeChecked);
  }
  return {
    pass: (0, _accessibility.computeAriaChecked)(instance) === true,
    message: () => {
      const is = this.isNot ? 'is' : 'is not';
      return [(0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toBeChecked`, 'instance', ''), '', `Received instance ${is} checked:`, (0, _redent.default)((0, _formatElement.formatElement)(instance), 2)].join('\n');
    }
  };
}
function isSupportedAccessibilityElement(instance) {
  if (!(0, _accessibility.isAccessibilityElement)(instance)) {
    return false;
  }
  const role = (0, _accessibility.getRole)(instance);
  return _accessibility.rolesSupportingCheckedState[role];
}
//# sourceMappingURL=to-be-checked.js.map