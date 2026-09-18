"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getContainerInstance = getContainerInstance;
exports.getInstanceSiblings = getInstanceSiblings;
exports.isInstanceMounted = isInstanceMounted;
exports.isTestInstance = isTestInstance;
var _screen = require("../screen");
/**
 * Checks if the given element is a host element.
 * @param node The element to check.
 */
function isTestInstance(node) {
  return typeof node !== 'string' && typeof node?.type === 'string';
}
function isInstanceMounted(instance) {
  return getContainerInstance(instance) === _screen.screen.container;
}

/**
 * Returns host siblings for given element.
 * @param instance The element start traversing from.
 */
function getInstanceSiblings(instance) {
  // Should not happen
  const parent = instance.parent;
  if (!parent) {
    return [];
  }
  return parent.children.filter(sibling => typeof sibling !== 'string' && sibling !== instance);
}

/**
 * Returns the container element of the tree.
 *
 * @param instance The element start traversing from.
 * @returns The container element of the tree.
 */
function getContainerInstance(instance) {
  let current = instance;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}
//# sourceMappingURL=component-tree.js.map