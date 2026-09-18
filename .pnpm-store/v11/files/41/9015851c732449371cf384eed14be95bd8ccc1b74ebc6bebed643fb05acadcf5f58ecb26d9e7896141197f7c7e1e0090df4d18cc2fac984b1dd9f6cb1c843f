"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toBeVisible = toBeVisible;
var _jestMatcherUtils = require("jest-matcher-utils");
var _reactNative = require("react-native");
var _redent = _interopRequireDefault(require("redent"));
var _accessibility = require("../helpers/accessibility");
var _formatElement = require("../helpers/format-element");
var _hostComponentNames = require("../helpers/host-component-names");
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function toBeVisible(instance) {
  if (instance !== null || !this.isNot) {
    (0, _utils.checkHostElement)(instance, toBeVisible, this);
  }
  return {
    pass: isElementVisible(instance),
    message: () => {
      const is = this.isNot ? 'is' : 'is not';
      return [(0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toBeVisible`, 'instance', ''), '', `Received instance ${is} visible:`, (0, _redent.default)((0, _formatElement.formatElement)(instance), 2)].join('\n');
    }
  };
}
function isElementVisible(instance, accessibilityCache) {
  // Use cache to speed up repeated searches by `isHiddenFromAccessibility`.
  const cache = accessibilityCache ?? new WeakMap();
  if ((0, _accessibility.isHiddenFromAccessibility)(instance, {
    cache
  })) {
    return false;
  }
  if (isHiddenForStyles(instance)) {
    return false;
  }

  // Note: this seems to be a bug in React Native.
  // PR with fix: https://github.com/facebook/react-native/pull/39157
  if ((0, _hostComponentNames.isHostModal)(instance) && instance.props.visible === false) {
    return false;
  }
  const parent = instance.parent;
  if (parent === null) {
    return true;
  }
  return isElementVisible(parent, cache);
}
function isHiddenForStyles(instance) {
  const flatStyle = _reactNative.StyleSheet.flatten(instance.props.style);
  return flatStyle?.display === 'none' || flatStyle?.opacity === 0;
}
//# sourceMappingURL=to-be-visible.js.map