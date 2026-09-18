"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toContainElement = toContainElement;
var _jestMatcherUtils = require("jest-matcher-utils");
var _redent = _interopRequireDefault(require("redent"));
var _formatElement = require("../helpers/format-element");
var _utils = require("./utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function toContainElement(container, instance) {
  (0, _utils.checkHostElement)(container, toContainElement, this);
  if (instance !== null) {
    (0, _utils.checkHostElement)(instance, toContainElement, this);
  }
  let matches = [];
  if (instance) {
    matches = container.queryAll(node => node === instance);
  }
  return {
    pass: matches.length > 0,
    message: () => {
      return [(0, _jestMatcherUtils.matcherHint)(`${this.isNot ? '.not' : ''}.toContainElement`, 'container', 'instance'), '', (0, _jestMatcherUtils.RECEIVED_COLOR)(`${(0, _redent.default)((0, _formatElement.formatElement)(container), 2)} ${this.isNot ? '\n\ncontains:\n\n' : '\n\ndoes not contain:\n\n'} ${(0, _redent.default)((0, _formatElement.formatElement)(instance), 2)}
        `)].join('\n');
    }
  };
}
//# sourceMappingURL=to-contain-element.js.map