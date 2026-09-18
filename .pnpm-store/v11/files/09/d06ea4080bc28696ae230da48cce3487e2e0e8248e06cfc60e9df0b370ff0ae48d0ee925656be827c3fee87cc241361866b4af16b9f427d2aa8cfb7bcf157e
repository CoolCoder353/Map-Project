"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "UserEventConfig", {
  enumerable: true,
  get: function () {
    return _setup.UserEventConfig;
  }
});
exports.userEvent = void 0;
var _setup = require("./setup");
const userEvent = exports.userEvent = {
  setup: _setup.setup,
  // Direct access for User Event v13 compatibility
  press: instance => (0, _setup.setup)().press(instance),
  longPress: (instance, options) => (0, _setup.setup)().longPress(instance, options),
  type: (instance, text, options) => (0, _setup.setup)().type(instance, text, options),
  clear: instance => (0, _setup.setup)().clear(instance),
  paste: (instance, text) => (0, _setup.setup)().paste(instance, text),
  scrollTo: (instance, options) => (0, _setup.setup)().scrollTo(instance, options)
};
//# sourceMappingURL=index.js.map