"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.paste = paste;
var _eventBuilder = require("../event-builder");
var _errors = require("../helpers/errors");
var _hostComponentNames = require("../helpers/host-component-names");
var _pointerEvents = require("../helpers/pointer-events");
var _textInput = require("../helpers/text-input");
var _nativeState = require("../native-state");
var _utils = require("./utils");
async function paste(instance, text) {
  if (!(0, _hostComponentNames.isHostTextInput)(instance)) {
    throw new _errors.ErrorWithStack(`paste() only supports host "TextInput" instances. Passed instance has type: "${instance.type}".`, paste);
  }
  if (!(0, _textInput.isEditableTextInput)(instance) || !(0, _pointerEvents.isPointerEventEnabled)(instance)) {
    return;
  }

  // 1. Enter instance
  await (0, _utils.dispatchEvent)(instance, 'focus', (0, _eventBuilder.buildFocusEvent)());

  // 2. Select all
  const textToClear = (0, _textInput.getTextInputValue)(instance);
  const rangeToClear = {
    start: 0,
    end: textToClear.length
  };
  await (0, _utils.dispatchEvent)(instance, 'selectionChange', (0, _eventBuilder.buildTextSelectionChangeEvent)(rangeToClear));

  // 3. Paste the text
  _nativeState.nativeState.valueForInstance.set(instance, text);
  const rangeAfter = {
    start: text.length,
    end: text.length
  };
  await (0, _utils.dispatchEvent)(instance, 'change', (0, _eventBuilder.buildTextChangeEvent)(text, rangeAfter));
  await (0, _utils.dispatchEvent)(instance, 'changeText', text);
  await (0, _utils.dispatchEvent)(instance, 'selectionChange', (0, _eventBuilder.buildTextSelectionChangeEvent)(rangeAfter));

  // According to the docs only multiline TextInput emits contentSizeChange event
  // @see: https://reactnative.dev/docs/textinput#oncontentsizechange
  const isMultiline = instance.props.multiline === true;
  if (isMultiline) {
    const contentSize = (0, _utils.getTextContentSize)(text);
    await (0, _utils.dispatchEvent)(instance, 'contentSizeChange', (0, _eventBuilder.buildContentSizeChangeEvent)(contentSize));
  }

  // 4. Exit instance
  await (0, _utils.wait)(this.config);
  await (0, _utils.dispatchEvent)(instance, 'endEditing', (0, _eventBuilder.buildEndEditingEvent)(text));
  await (0, _utils.dispatchEvent)(instance, 'blur', (0, _eventBuilder.buildBlurEvent)());
}
//# sourceMappingURL=paste.js.map