"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toHaveAccessibleName = toHaveAccessibleName;
var _jestMatcherUtils = require("jest-matcher-utils");
var _accessibility = require("../helpers/accessibility");
var _matches = require("../matches");
var _utils = require("./utils");
function toHaveAccessibleName(instance, expectedName, options) {
  (0, _utils.checkHostElement)(instance, toHaveAccessibleName, this);
  const receivedName = (0, _accessibility.computeAccessibleName)(instance);
  const missingExpectedValue = arguments.length === 1;
  const pass = missingExpectedValue ? receivedName !== '' : expectedName != null ? (0, _matches.matches)(expectedName, receivedName, options?.normalizer, options?.exact) : false;
  return {
    pass,
    message: () => {
      return [(0, _utils.formatMessage)((0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toHaveAccessibleName`, 'instance', ''), `Expected instance ${this.isNot ? 'not to' : 'to'} have accessible name`, expectedName, 'Received', receivedName)].join('\n');
    }
  };
}
//# sourceMappingURL=to-have-accessible-name.js.map