"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isPointerEventEnabled = void 0;
var _reactNative = require("react-native");
/**
 * pointerEvents controls whether the View can be the target of touch events.
 * 'auto': The View and its children can be the target of touch events.
 * 'none': The View is never the target of touch events.
 * 'box-none': The View is never the target of touch events but its subviews can be
 * 'box-only': The view can be the target of touch events but its subviews cannot be
 * see the official react native doc https://reactnative.dev/docs/view#pointerevents */
const isPointerEventEnabled = (instance, isParent) => {
  // Check both props.pointerEvents and props.style.pointerEvents
  const pointerEvents = instance?.props.pointerEvents ?? _reactNative.StyleSheet.flatten(instance?.props.style)?.pointerEvents;
  const parentCondition = isParent ? pointerEvents === 'box-only' : pointerEvents === 'box-none';
  if (pointerEvents === 'none' || parentCondition) {
    return false;
  }
  if (!instance.parent) {
    return true;
  }
  return isPointerEventEnabled(instance.parent, true);
};
exports.isPointerEventEnabled = isPointerEventEnabled;
//# sourceMappingURL=pointer-events.js.map