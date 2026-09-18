"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.dispatchEvent = dispatchEvent;
var _act = require("../../act");
var _eventHandler = require("../../event-handler");
var _componentTree = require("../../helpers/component-tree");
/**
 * Basic dispatch event function used by User Event module.
 *
 * @param instance instance to trigger event on
 * @param eventName name of the event
 * @param event event payload(s)
 */
async function dispatchEvent(instance, eventName, ...event) {
  if (!(0, _componentTree.isInstanceMounted)(instance)) {
    return;
  }
  const handler = (0, _eventHandler.getEventHandlerFromProps)(instance.props, eventName);
  if (!handler) {
    return;
  }
  await (0, _act.act)(() => {
    handler(...event);
  });
}
//# sourceMappingURL=dispatch-event.js.map