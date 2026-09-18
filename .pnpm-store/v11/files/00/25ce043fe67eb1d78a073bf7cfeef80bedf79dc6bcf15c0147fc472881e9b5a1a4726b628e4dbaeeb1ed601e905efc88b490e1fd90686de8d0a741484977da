"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getTextInputValue = getTextInputValue;
exports.isEditableTextInput = isEditableTextInput;
var _nativeState = require("../native-state");
var _hostComponentNames = require("./host-component-names");
function isEditableTextInput(instance) {
  return (0, _hostComponentNames.isHostTextInput)(instance) && instance.props.editable !== false;
}
function getTextInputValue(instance) {
  if (!(0, _hostComponentNames.isHostTextInput)(instance)) {
    throw new Error(`Element is not a "TextInput", but it has type "${instance.type}".`);
  }
  return instance.props.value ?? _nativeState.nativeState.valueForInstance.get(instance) ?? instance.props.defaultValue ?? '';
}
//# sourceMappingURL=text-input.js.map