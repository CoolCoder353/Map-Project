"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.HOST_TEXT_NAMES = void 0;
exports.isHostImage = isHostImage;
exports.isHostModal = isHostModal;
exports.isHostScrollView = isHostScrollView;
exports.isHostSwitch = isHostSwitch;
exports.isHostText = isHostText;
exports.isHostTextInput = isHostTextInput;
const HOST_TEXT_NAMES = exports.HOST_TEXT_NAMES = ['Text', 'RCTText'];
const HOST_TEXT_INPUT_NAMES = ['TextInput'];
const HOST_IMAGE_NAMES = ['Image'];
const HOST_SWITCH_NAMES = ['RCTSwitch'];
const HOST_SCROLL_VIEW_NAMES = ['RCTScrollView'];
const HOST_MODAL_NAMES = ['Modal'];

/**
 * Checks if the given element is a host Text element.
 * @param instance The instance to check.
 */
function isHostText(instance) {
  return typeof instance?.type === 'string' && HOST_TEXT_NAMES.includes(instance.type);
}

/**
 * Checks if the given element is a host TextInput element.
 * @param instance The instance to check.
 */
function isHostTextInput(instance) {
  return typeof instance?.type === 'string' && HOST_TEXT_INPUT_NAMES.includes(instance.type);
}

/**
 * Checks if the given element is a host Image element.
 * @param instance The instance to check.
 */
function isHostImage(instance) {
  return typeof instance?.type === 'string' && HOST_IMAGE_NAMES.includes(instance.type);
}

/**
 * Checks if the given element is a host Switch element.
 * @param instance The instance to check.
 */
function isHostSwitch(instance) {
  return typeof instance?.type === 'string' && HOST_SWITCH_NAMES.includes(instance.type);
}

/**
 * Checks if the given element is a host ScrollView element.
 * @param instance The instance to check.
 */
function isHostScrollView(instance) {
  return typeof instance?.type === 'string' && HOST_SCROLL_VIEW_NAMES.includes(instance.type);
}

/**
 * Checks if the given element is a host Modal element.
 * @param instance The instance to check.
 */
function isHostModal(instance) {
  return typeof instance?.type === 'string' && HOST_MODAL_NAMES.includes(instance.type);
}
//# sourceMappingURL=host-component-names.js.map