"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildContentSizeChangeEvent = buildContentSizeChangeEvent;
exports.buildEndEditingEvent = buildEndEditingEvent;
exports.buildKeyPressEvent = buildKeyPressEvent;
exports.buildSubmitEditingEvent = buildSubmitEditingEvent;
exports.buildTextChangeEvent = buildTextChangeEvent;
exports.buildTextSelectionChangeEvent = buildTextSelectionChangeEvent;
var _base = require("./base");
/**
 * Experimental values:
 * - iOS: `{"eventCount": 4, "target": 75, "text": "Test"}`
 * - Android: `{"eventCount": 6, "target": 53, "text": "Tes"}`
 */
function buildTextChangeEvent(text, {
  start,
  end
}) {
  return {
    ...(0, _base.baseSyntheticEvent)(),
    nativeEvent: {
      text,
      target: 0,
      eventCount: 0,
      selection: {
        start,
        end
      }
    }
  };
}

/**
 * Experimental values:
 * - iOS: `{"eventCount": 3, "key": "a", "target": 75}`
 * - Android: `{"key": "a"}`
 */
function buildKeyPressEvent(key) {
  return {
    ...(0, _base.baseSyntheticEvent)(),
    nativeEvent: {
      key
    }
  };
}

/**
 * Experimental values:
 * - iOS: `{"eventCount": 4, "target": 75, "text": "Test"}`
 * - Android: `{"target": 53, "text": "Test"}`
 */
function buildSubmitEditingEvent(text) {
  return {
    ...(0, _base.baseSyntheticEvent)(),
    nativeEvent: {
      text,
      target: 0
    }
  };
}

/**
 * Experimental values:
 * - iOS: `{"eventCount": 4, "target": 75, "text": "Test"}`
 * - Android: `{"target": 53, "text": "Test"}`
 */
function buildEndEditingEvent(text) {
  return {
    ...(0, _base.baseSyntheticEvent)(),
    nativeEvent: {
      text,
      target: 0
    }
  };
}

/**
 * Experimental values:
 * - iOS: `{"selection": {"end": 4, "start": 4}, "target": 75}`
 * - Android: `{"selection": {"end": 4, "start": 4}}`
 */
function buildTextSelectionChangeEvent({
  start,
  end
}) {
  return {
    ...(0, _base.baseSyntheticEvent)(),
    nativeEvent: {
      selection: {
        start,
        end
      }
    }
  };
}

/**
 * Experimental values:
 * - iOS: `{"contentSize": {"height": 21.666666666666668, "width": 11.666666666666666}, "target": 75}`
 * - Android: `{"contentSize": {"height": 61.45454406738281, "width": 352.7272644042969}, "target": 53}`
 */
function buildContentSizeChangeEvent({
  width,
  height
}) {
  return {
    ...(0, _base.baseSyntheticEvent)(),
    nativeEvent: {
      contentSize: {
        width,
        height
      },
      target: 0
    }
  };
}
//# sourceMappingURL=text.js.map