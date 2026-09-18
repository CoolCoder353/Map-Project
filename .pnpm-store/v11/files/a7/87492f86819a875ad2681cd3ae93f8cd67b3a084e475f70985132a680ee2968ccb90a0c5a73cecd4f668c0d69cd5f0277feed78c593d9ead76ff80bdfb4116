"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.emitTypingEvents = emitTypingEvents;
exports.type = type;
var _eventBuilder = require("../../event-builder");
var _errors = require("../../helpers/errors");
var _hostComponentNames = require("../../helpers/host-component-names");
var _pointerEvents = require("../../helpers/pointer-events");
var _textInput = require("../../helpers/text-input");
var _nativeState = require("../../native-state");
var _utils = require("../utils");
var _parseKeys = require("./parse-keys");
async function type(instance, text, options) {
  if (!(0, _hostComponentNames.isHostTextInput)(instance)) {
    throw new _errors.ErrorWithStack(`type() works only with host "TextInput" instances. Passed instance has type "${instance.type}".`, type);
  }

  // Skip events if the instance is disabled
  if (!(0, _textInput.isEditableTextInput)(instance) || !(0, _pointerEvents.isPointerEventEnabled)(instance)) {
    return;
  }
  const keys = (0, _parseKeys.parseKeys)(text);
  if (!options?.skipPress) {
    await (0, _utils.dispatchEvent)(instance, 'pressIn', (0, _eventBuilder.buildTouchEvent)());
  }
  await (0, _utils.dispatchEvent)(instance, 'focus', (0, _eventBuilder.buildFocusEvent)());
  if (!options?.skipPress) {
    await (0, _utils.wait)(this.config);
    await (0, _utils.dispatchEvent)(instance, 'pressOut', (0, _eventBuilder.buildTouchEvent)());
  }
  for (const key of keys) {
    const previousText = (0, _textInput.getTextInputValue)(instance);
    const proposedText = applyKey(previousText, key);
    const isAccepted = isTextChangeAccepted(instance, proposedText);
    const currentText = isAccepted ? proposedText : previousText;
    await emitTypingEvents(instance, {
      config: this.config,
      key,
      text: currentText,
      isAccepted
    });
  }
  const finalText = (0, _textInput.getTextInputValue)(instance);
  await (0, _utils.wait)(this.config);
  if (options?.submitEditing) {
    await (0, _utils.dispatchEvent)(instance, 'submitEditing', (0, _eventBuilder.buildSubmitEditingEvent)(finalText));
  }
  if (!options?.skipBlur) {
    await (0, _utils.dispatchEvent)(instance, 'endEditing', (0, _eventBuilder.buildEndEditingEvent)(finalText));
    await (0, _utils.dispatchEvent)(instance, 'blur', (0, _eventBuilder.buildBlurEvent)());
  }
}
async function emitTypingEvents(instance, {
  config,
  key,
  text,
  isAccepted
}) {
  const isMultiline = instance.props.multiline === true;
  await (0, _utils.wait)(config);
  await (0, _utils.dispatchEvent)(instance, 'keyPress', (0, _eventBuilder.buildKeyPressEvent)(key));

  // Platform difference (based on experiments):
  // - iOS and RN Web: TextInput emits only `keyPress` event when max length has been reached
  // - Android: TextInputs does not emit any events
  if (isAccepted === false) {
    return;
  }
  _nativeState.nativeState.valueForInstance.set(instance, text);
  const selectionRange = {
    start: text.length,
    end: text.length
  };
  await (0, _utils.dispatchEvent)(instance, 'change', (0, _eventBuilder.buildTextChangeEvent)(text, selectionRange));
  await (0, _utils.dispatchEvent)(instance, 'changeText', text);
  await (0, _utils.dispatchEvent)(instance, 'selectionChange', (0, _eventBuilder.buildTextSelectionChangeEvent)(selectionRange));

  // According to the docs only multiline TextInput emits contentSizeChange event
  // @see: https://reactnative.dev/docs/textinput#oncontentsizechange
  if (isMultiline) {
    const contentSize = (0, _utils.getTextContentSize)(text);
    await (0, _utils.dispatchEvent)(instance, 'contentSizeChange', (0, _eventBuilder.buildContentSizeChangeEvent)(contentSize));
  }
}
function applyKey(text, key) {
  if (key === 'Enter') {
    return `${text}\n`;
  }
  if (key === 'Backspace') {
    return text.slice(0, -1);
  }
  return text + key;
}
function isTextChangeAccepted(instance, text) {
  const maxLength = instance.props.maxLength;
  return maxLength === undefined || text.length <= maxLength;
}
//# sourceMappingURL=type.js.map