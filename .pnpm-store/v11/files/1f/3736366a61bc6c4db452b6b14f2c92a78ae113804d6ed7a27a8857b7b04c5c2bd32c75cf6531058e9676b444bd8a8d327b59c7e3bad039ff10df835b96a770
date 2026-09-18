"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.accessibilityValueKeys = exports.accessibilityStateKeys = void 0;
exports.computeAccessibleName = computeAccessibleName;
exports.computeAriaBusy = computeAriaBusy;
exports.computeAriaChecked = computeAriaChecked;
exports.computeAriaDisabled = computeAriaDisabled;
exports.computeAriaExpanded = computeAriaExpanded;
exports.computeAriaLabel = computeAriaLabel;
exports.computeAriaModal = computeAriaModal;
exports.computeAriaSelected = computeAriaSelected;
exports.computeAriaValue = computeAriaValue;
exports.getRole = getRole;
exports.isAccessibilityElement = isAccessibilityElement;
exports.isHiddenFromAccessibility = isHiddenFromAccessibility;
exports.isInaccessible = void 0;
exports.normalizeRole = normalizeRole;
exports.rolesSupportingCheckedState = void 0;
var _reactNative = require("react-native");
var _componentTree = require("./component-tree");
var _findAll = require("./find-all");
var _hostComponentNames = require("./host-component-names");
var _textContent = require("./text-content");
var _textInput = require("./text-input");
const accessibilityStateKeys = exports.accessibilityStateKeys = ['disabled', 'selected', 'checked', 'busy', 'expanded'];
const accessibilityValueKeys = exports.accessibilityValueKeys = ['min', 'max', 'now', 'text'];
function isHiddenFromAccessibility(instance, {
  cache
} = {}) {
  if (instance == null) {
    return true;
  }
  let current = instance;
  while (current) {
    let isCurrentSubtreeInaccessible = cache?.get(current);
    if (isCurrentSubtreeInaccessible === undefined) {
      isCurrentSubtreeInaccessible = isSubtreeInaccessible(current);
      cache?.set(current, isCurrentSubtreeInaccessible);
    }
    if (isCurrentSubtreeInaccessible) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** RTL-compatibility alias for `isHiddenFromAccessibility` */
const isInaccessible = exports.isInaccessible = isHiddenFromAccessibility;
function isSubtreeInaccessible(instance) {
  // See: https://reactnative.dev/docs/accessibility#aria-hidden
  if (instance.props['aria-hidden']) {
    return true;
  }

  // iOS: accessibilityElementsHidden
  // See: https://reactnative.dev/docs/accessibility#accessibilityelementshidden-ios
  if (instance.props.accessibilityElementsHidden) {
    return true;
  }

  // Android: importantForAccessibility
  // See: https://reactnative.dev/docs/accessibility#importantforaccessibility-android
  if (instance.props.importantForAccessibility === 'no-hide-descendants') {
    return true;
  }

  // Note that `opacity: 0` is not treated as inaccessible on iOS
  const flatStyle = _reactNative.StyleSheet.flatten(instance.props.style) ?? {};
  if (flatStyle.display === 'none') return true;

  // iOS: accessibilityViewIsModal or aria-modal
  // See: https://reactnative.dev/docs/accessibility#accessibilityviewismodal-ios
  const hostSiblings = (0, _componentTree.getInstanceSiblings)(instance);
  if (hostSiblings.some(sibling => computeAriaModal(sibling))) {
    return true;
  }
  return false;
}
function isAccessibilityElement(instance) {
  if (instance == null) {
    return false;
  }

  // https://github.com/facebook/react-native/blob/8dabed60f456e76a9e53273b601446f34de41fb5/packages/react-native/Libraries/Image/Image.ios.js#L172
  if ((0, _hostComponentNames.isHostImage)(instance) && instance.props.alt !== undefined) {
    return true;
  }
  if (instance.props.accessible !== undefined) {
    return instance.props.accessible;
  }
  return (0, _hostComponentNames.isHostText)(instance) || (0, _hostComponentNames.isHostTextInput)(instance) || (0, _hostComponentNames.isHostSwitch)(instance);
}

/**
 * Returns the accessibility role for given element. It will return explicit
 * role from either `role` or `accessibilityRole` props if set.
 *
 * If explicit role is not available, it would try to return default element
 * role:
 * - `text` for `Text` elements
 *
 * In all other cases this functions returns `none`.
 *
 * @param instance
 * @returns
 */
function getRole(instance) {
  const explicitRole = instance.props.role ?? instance.props.accessibilityRole;
  if (explicitRole) {
    return normalizeRole(explicitRole);
  }
  if ((0, _hostComponentNames.isHostText)(instance)) {
    return 'text';
  }

  // Note: host Image elements report "image" role in screen reader only on Android, but not on iOS.
  // It's better to require explicit role for Image elements.

  return 'none';
}

/**
 * There are some duplications between (ARIA) `Role` and `AccessibilityRole` types.
 * Resolve them by using ARIA `Role` type where possible.
 *
 * @param role Role to normalize
 * @returns Normalized role
 */
function normalizeRole(role) {
  if (role === 'image') {
    return 'img';
  }
  return role;
}
function computeAriaModal(instance) {
  return instance.props['aria-modal'] ?? instance.props.accessibilityViewIsModal;
}
function computeAriaLabel(instance) {
  const labelElementIds = getAriaLabelledByIds(instance);
  if (labelElementIds.length > 0) {
    const container = (0, _componentTree.getContainerInstance)(instance);
    const labelTexts = labelElementIds.map(labelElementId => {
      const labelInstance = (0, _findAll.findAll)(container, node => (0, _componentTree.isTestInstance)(node) && node.props.nativeID === labelElementId, {
        includeHiddenElements: true
      });
      return labelInstance.length > 0 ? (0, _textContent.getTextContent)(labelInstance[0]) : undefined;
    }).filter(labelText => labelText !== undefined);
    if (labelTexts.length > 0) {
      return labelTexts.join(' ').trim().replace(/\s+/g, ' ');
    }
  }
  const explicitLabel = instance.props['aria-label'] ?? instance.props.accessibilityLabel;
  if (explicitLabel) {
    return explicitLabel;
  }

  //https://github.com/facebook/react-native/blob/8dabed60f456e76a9e53273b601446f34de41fb5/packages/react-native/Libraries/Image/Image.ios.js#L173
  if ((0, _hostComponentNames.isHostImage)(instance) && instance.props.alt) {
    return instance.props.alt;
  }
  return undefined;
}
function getAriaLabelledByIds(instance) {
  const ariaLabelledBy = instance.props['aria-labelledby'];
  if (typeof ariaLabelledBy === 'string') {
    return [ariaLabelledBy];
  }
  const accessibilityLabelledBy = instance.props.accessibilityLabelledBy;
  if (Array.isArray(accessibilityLabelledBy)) {
    return accessibilityLabelledBy;
  }
  if (typeof accessibilityLabelledBy === 'string') {
    return [accessibilityLabelledBy];
  }
  return [];
}

// See: https://github.com/callstack/react-native-testing-library/wiki/Accessibility:-State#busy-state
function computeAriaBusy({
  props
}) {
  return props['aria-busy'] ?? props.accessibilityState?.busy ?? false;
}

// See: https://github.com/callstack/react-native-testing-library/wiki/Accessibility:-State#checked-state
function computeAriaChecked(instance) {
  const {
    props
  } = instance;
  if ((0, _hostComponentNames.isHostSwitch)(instance)) {
    return props.value;
  }
  const role = getRole(instance);
  if (!rolesSupportingCheckedState[role]) {
    return undefined;
  }
  return props['aria-checked'] ?? props.accessibilityState?.checked;
}

// See: https://github.com/callstack/react-native-testing-library/wiki/Accessibility:-State#disabled-state
function computeAriaDisabled(instance) {
  if ((0, _hostComponentNames.isHostTextInput)(instance) && !(0, _textInput.isEditableTextInput)(instance)) {
    return true;
  }
  const {
    props
  } = instance;
  if ((0, _hostComponentNames.isHostText)(instance) && props.disabled) {
    return true;
  }
  return props['aria-disabled'] ?? props.accessibilityState?.disabled ?? false;
}

// See: https://github.com/callstack/react-native-testing-library/wiki/Accessibility:-State#expanded-state
function computeAriaExpanded({
  props
}) {
  return props['aria-expanded'] ?? props.accessibilityState?.expanded;
}

// See: https://github.com/callstack/react-native-testing-library/wiki/Accessibility:-State#selected-state
function computeAriaSelected({
  props
}) {
  return props['aria-selected'] ?? props.accessibilityState?.selected ?? false;
}
function computeAriaValue(instance) {
  const {
    accessibilityValue,
    'aria-valuemax': ariaValueMax,
    'aria-valuemin': ariaValueMin,
    'aria-valuenow': ariaValueNow,
    'aria-valuetext': ariaValueText
  } = instance.props;
  return {
    max: ariaValueMax ?? accessibilityValue?.max,
    min: ariaValueMin ?? accessibilityValue?.min,
    now: ariaValueNow ?? accessibilityValue?.now,
    text: ariaValueText ?? accessibilityValue?.text
  };
}
function computeAccessibleName(instance, options) {
  const label = computeAriaLabel(instance);
  if (label) {
    return label;
  }
  if ((0, _hostComponentNames.isHostTextInput)(instance) && instance.props.placeholder && options?.root !== false) {
    return instance.props.placeholder;
  }
  const parts = [];
  for (const child of instance.children) {
    if (typeof child === 'string') {
      if (child) {
        parts.push({
          text: child,
          isInlineText: true
        });
      }
    } else {
      const childLabel = computeAccessibleName(child, {
        root: false
      });
      if (childLabel) {
        parts.push({
          text: childLabel,
          isInlineText: (0, _hostComponentNames.isHostText)(child)
        });
      }
    }
  }
  return joinAccessibleNameParts(parts, {
    inline: (0, _hostComponentNames.isHostText)(instance)
  });
}
function joinAccessibleNameParts(parts, options) {
  return parts.reduce((accessibleName, part, index) => {
    if (index === 0) {
      return part.text;
    }
    const previousPart = parts[index - 1];
    const separator = options.inline && previousPart.isInlineText && part.isInlineText ? '' : ' ';
    return `${accessibleName}${separator}${part.text}`;
  }, '');
}
const rolesSupportingCheckedState = exports.rolesSupportingCheckedState = {
  checkbox: true,
  radio: true,
  switch: true
};
//# sourceMappingURL=accessibility.js.map