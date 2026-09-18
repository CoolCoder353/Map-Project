"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getEventHandlerFromProps = getEventHandlerFromProps;
function getEventHandlerFromProps(props, eventName, options) {
  const handlerName = getEventHandlerName(eventName);
  if (typeof props[handlerName] === 'function') {
    return props[handlerName];
  }
  if (options?.loose && typeof props[eventName] === 'function') {
    return props[eventName];
  }
  if (typeof props[`testOnly_${handlerName}`] === 'function') {
    return props[`testOnly_${handlerName}`];
  }
  if (options?.loose && typeof props[`testOnly_${eventName}`] === 'function') {
    return props[`testOnly_${eventName}`];
  }
  return undefined;
}
function getEventHandlerName(eventName) {
  return `on${capitalizeFirstLetter(eventName)}`;
}
function capitalizeFirstLetter(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
//# sourceMappingURL=event-handler.js.map