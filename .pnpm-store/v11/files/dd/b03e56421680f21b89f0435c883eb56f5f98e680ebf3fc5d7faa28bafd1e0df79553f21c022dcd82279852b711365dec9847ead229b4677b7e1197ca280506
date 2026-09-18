"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DEFAULT_MIN_PRESS_DURATION = exports.DEFAULT_LONG_PRESS_DELAY_MS = void 0;
exports.longPress = longPress;
exports.press = press;
var _act = require("../../act");
var _eventBuilder = require("../../event-builder");
var _eventHandler = require("../../event-handler");
var _componentTree = require("../../helpers/component-tree");
var _errors = require("../../helpers/errors");
var _hostComponentNames = require("../../helpers/host-component-names");
var _pointerEvents = require("../../helpers/pointer-events");
var _utils = require("../utils");
// These are constants defined in the React Native repo
// See: https://github.com/facebook/react-native/blob/50e38cc9f1e6713228a91ad50f426c4f65e65e1a/packages/react-native/Libraries/Pressability/Pressability.js#L264
const DEFAULT_MIN_PRESS_DURATION = exports.DEFAULT_MIN_PRESS_DURATION = 130;
const DEFAULT_LONG_PRESS_DELAY_MS = exports.DEFAULT_LONG_PRESS_DELAY_MS = 500;
async function press(instance) {
  if (!(0, _componentTree.isTestInstance)(instance)) {
    throw new _errors.ErrorWithStack(`press() works only with host instances.`, press);
  }
  await basePress(this.config, instance, {
    type: 'press'
  });
}
async function longPress(instance, options) {
  if (!(0, _componentTree.isTestInstance)(instance)) {
    throw new _errors.ErrorWithStack(`longPress() works only with host instances.`, longPress);
  }
  await basePress(this.config, instance, {
    type: 'longPress',
    duration: options?.duration ?? DEFAULT_LONG_PRESS_DELAY_MS
  });
}
const basePress = async (config, instance, options) => {
  if (isEnabledHostElement(instance) && hasPressEventHandler(instance)) {
    await emitDirectPressEvents(config, instance, options);
    return;
  }
  if (isEnabledTouchResponder(instance)) {
    await emitPressabilityPressEvents(config, instance, options);
    return;
  }
  if (!instance.parent) {
    return;
  }
  await basePress(config, instance.parent, options);
};
function isEnabledHostElement(instance) {
  if (!(0, _pointerEvents.isPointerEventEnabled)(instance)) {
    return false;
  }
  if ((0, _hostComponentNames.isHostText)(instance)) {
    return instance.props.disabled !== true;
  }
  if ((0, _hostComponentNames.isHostTextInput)(instance)) {
    return instance.props.editable !== false;
  }
  return true;
}
function isEnabledTouchResponder(instance) {
  return (0, _pointerEvents.isPointerEventEnabled)(instance) && instance.props.onStartShouldSetResponder?.();
}
function hasPressEventHandler(instance) {
  return (0, _eventHandler.getEventHandlerFromProps)(instance.props, 'press') || (0, _eventHandler.getEventHandlerFromProps)(instance.props, 'longPress') || (0, _eventHandler.getEventHandlerFromProps)(instance.props, 'pressIn') || (0, _eventHandler.getEventHandlerFromProps)(instance.props, 'pressOut');
}

/**
 * Dispatches a press event sequence for host instances that have `onPress*` event handlers.
 */
async function emitDirectPressEvents(config, instance, options) {
  await (0, _utils.wait)(config);
  await (0, _utils.dispatchEvent)(instance, 'pressIn', (0, _eventBuilder.buildTouchEvent)());
  await (0, _utils.wait)(config, options.duration);

  // Long press events are emitted before `pressOut`.
  if (options.type === 'longPress') {
    await (0, _utils.dispatchEvent)(instance, 'longPress', (0, _eventBuilder.buildTouchEvent)());
  }
  await (0, _utils.dispatchEvent)(instance, 'pressOut', (0, _eventBuilder.buildTouchEvent)());

  // Regular press events are emitted after `pressOut` according to the React Native docs.
  // See: https://reactnative.dev/docs/pressable#onpress
  // Experimentally for very short presses (< 130ms) `press` events are actually emitted before `onPressOut`, but
  // we will ignore that as in reality most pressed would be above the 130ms threshold.
  if (options.type === 'press') {
    await (0, _utils.dispatchEvent)(instance, 'press', (0, _eventBuilder.buildTouchEvent)());
  }
}
async function emitPressabilityPressEvents(config, instance, options) {
  await (0, _utils.wait)(config);
  await (0, _utils.dispatchEvent)(instance, 'responderGrant', (0, _eventBuilder.buildResponderGrantEvent)());
  const duration = options.duration ?? DEFAULT_MIN_PRESS_DURATION;
  await (0, _utils.wait)(config, duration);
  await (0, _utils.dispatchEvent)(instance, 'responderRelease', (0, _eventBuilder.buildResponderReleaseEvent)());

  // React Native will wait for minimal delay of DEFAULT_MIN_PRESS_DURATION
  // before emitting the `pressOut` event. We need to wait here, so that
  // `press()` function does not return before that.
  if (DEFAULT_MIN_PRESS_DURATION - duration > 0) {
    await (0, _act.act)(() => (0, _utils.wait)(config, DEFAULT_MIN_PRESS_DURATION - duration));
  }
}
//# sourceMappingURL=press.js.map