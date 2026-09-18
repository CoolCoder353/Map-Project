"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fireEvent = fireEvent;
var _act = require("./act");
var _eventBuilder = require("./event-builder");
var _eventHandler = require("./event-handler");
var _componentTree = require("./helpers/component-tree");
var _hostComponentNames = require("./helpers/host-component-names");
var _pointerEvents = require("./helpers/pointer-events");
var _textInput = require("./helpers/text-input");
var _nativeState = require("./native-state");
function isTouchResponder(instance) {
  return Boolean(instance.props.onStartShouldSetResponder) || (0, _hostComponentNames.isHostTextInput)(instance);
}

/**
 * List of events affected by `pointerEvents` prop.
 *
 * Note: `fireEvent` is accepting both `press` and `onPress` for event names,
 * so we need cover both forms.
 */
const eventsAffectedByPointerEventsProp = new Set(['press', 'onPress']);

/**
 * List of `TextInput` events not affected by `editable` prop.
 *
 * Note: `fireEvent` is accepting both `press` and `onPress` for event names,
 * so we need cover both forms.
 */
const textInputEventsIgnoringEditableProp = new Set(['contentSizeChange', 'onContentSizeChange', 'layout', 'onLayout', 'scroll', 'onScroll']);
function isEventEnabled(instance, eventName, nearestTouchResponder) {
  if (nearestTouchResponder != null && (0, _hostComponentNames.isHostTextInput)(nearestTouchResponder)) {
    return (0, _textInput.isEditableTextInput)(nearestTouchResponder) || textInputEventsIgnoringEditableProp.has(eventName);
  }
  if (eventsAffectedByPointerEventsProp.has(eventName) && !(0, _pointerEvents.isPointerEventEnabled)(instance)) {
    return false;
  }
  const touchStart = nearestTouchResponder?.props.onStartShouldSetResponder?.();
  const touchMove = nearestTouchResponder?.props.onMoveShouldSetResponder?.();
  if (touchStart || touchMove) {
    return true;
  }
  return touchStart === undefined && touchMove === undefined;
}
function findEventHandler(instance, eventName, nearestTouchResponder) {
  const touchResponder = isTouchResponder(instance) ? instance : nearestTouchResponder;
  const handler = (0, _eventHandler.getEventHandlerFromProps)(instance.props, eventName, {
    loose: true
  }) ?? findEventHandlerFromFiber(instance.unstable_fiber, eventName);
  if (handler && isEventEnabled(instance, eventName, touchResponder)) {
    return handler;
  }
  if (instance.parent === null) {
    return null;
  }
  return findEventHandler(instance.parent, eventName, touchResponder);
}
function findEventHandlerFromFiber(fiber, eventName) {
  // Container fibers have memoizedProps set to null
  if (!fiber?.memoizedProps) {
    return null;
  }
  const handler = (0, _eventHandler.getEventHandlerFromProps)(fiber.memoizedProps, eventName, {
    loose: true
  });
  if (handler) {
    return handler;
  }

  // No parent fiber or we reached another host element
  if (fiber.return === null || typeof fiber.return.type === 'string') {
    return null;
  }
  return findEventHandlerFromFiber(fiber.return, eventName);
}

// String union type of keys of T that start with on, stripped of 'on'

async function fireEvent(instance, eventName, ...data) {
  if (!(0, _componentTree.isInstanceMounted)(instance)) {
    return;
  }
  setNativeStateIfNeeded(instance, eventName, data[0]);
  const handler = findEventHandler(instance, eventName);
  if (!handler) {
    return;
  }
  let returnValue;
  await (0, _act.act)(() => {
    returnValue = handler(...data);
  });
  return returnValue;
}
fireEvent.changeText = async (instance, text) => await fireEvent(instance, 'changeText', text);
fireEvent.press = async (instance, eventProps) => {
  const event = (0, _eventBuilder.buildTouchEvent)();
  if (eventProps) {
    mergeEventProps(event, eventProps);
  }
  await fireEvent(instance, 'press', event);
};
fireEvent.scroll = async (instance, eventProps) => {
  const event = (0, _eventBuilder.buildScrollEvent)();
  if (eventProps) {
    mergeEventProps(event, eventProps);
  }
  await fireEvent(instance, 'scroll', event);
};
const scrollEventNames = new Set(['scroll', 'scrollBeginDrag', 'scrollEndDrag', 'momentumScrollBegin', 'momentumScrollEnd']);
function setNativeStateIfNeeded(instance, eventName, value) {
  if (eventName === 'changeText' && typeof value === 'string' && (0, _textInput.isEditableTextInput)(instance)) {
    _nativeState.nativeState.valueForInstance.set(instance, value);
  }
  if (scrollEventNames.has(eventName) && (0, _hostComponentNames.isHostScrollView)(instance)) {
    const contentOffset = tryGetContentOffset(value);
    if (contentOffset) {
      _nativeState.nativeState.contentOffsetForInstance.set(instance, contentOffset);
    }
  }
}
function tryGetContentOffset(event) {
  try {
    // @ts-expect-error: try to extract contentOffset from the event value
    const contentOffset = event?.nativeEvent?.contentOffset;
    const x = contentOffset?.x;
    const y = contentOffset?.y;
    if (typeof x === 'number' || typeof y === 'number') {
      return {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0
      };
    }
  } catch {
    // Do nothing
  }
  return null;
}
function mergeEventProps(target, source) {
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (sourceValue != null && typeof sourceValue === 'object' && !Array.isArray(sourceValue) && targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
      mergeEventProps(targetValue, sourceValue);
    } else {
      target[key] = sourceValue;
    }
  }
}
//# sourceMappingURL=fire-event.js.map