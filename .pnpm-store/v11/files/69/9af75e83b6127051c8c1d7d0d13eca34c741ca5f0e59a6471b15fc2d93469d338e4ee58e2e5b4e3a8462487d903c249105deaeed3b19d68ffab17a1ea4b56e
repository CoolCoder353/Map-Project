"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clear = clear;
var _eventBuilder = require("../event-builder");
var _errors = require("../helpers/errors");
var _hostComponentNames = require("../helpers/host-component-names");
var _pointerEvents = require("../helpers/pointer-events");
var _textInput = require("../helpers/text-input");
var _type = require("./type/type");
var _utils = require("./utils");
async function clear(instance) {
  if (!(0, _hostComponentNames.isHostTextInput)(instance)) {
    throw new _errors.ErrorWithStack(`clear() only supports host "TextInput" instances. Passed instance has type: "${instance.type}".`, clear);
  }
  if (!(0, _textInput.isEditableTextInput)(instance) || !(0, _pointerEvents.isPointerEventEnabled)(instance)) {
    return;
  }

  // 1. Enter instance
  await (0, _utils.dispatchEvent)(instance, 'focus', (0, _eventBuilder.buildFocusEvent)());

  // 2. Select all
  const textToClear = (0, _textInput.getTextInputValue)(instance);
  const selectionRange = {
    start: 0,
    end: textToClear.length
  };
  await (0, _utils.dispatchEvent)(instance, 'selectionChange', (0, _eventBuilder.buildTextSelectionChangeEvent)(selectionRange));

  // 3. Press backspace with selected text
  const emptyText = '';
  await (0, _type.emitTypingEvents)(instance, {
    config: this.config,
    key: 'Backspace',
    text: emptyText
  });

  // 4. Exit instance
  await (0, _utils.wait)(this.config);
  await (0, _utils.dispatchEvent)(instance, 'endEditing', (0, _eventBuilder.buildEndEditingEvent)(emptyText));
  await (0, _utils.dispatchEvent)(instance, 'blur', (0, _eventBuilder.buildBlurEvent)());
}
//# sourceMappingURL=clear.js.map