"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.matchTextContent = matchTextContent;
var _matches = require("../../matches");
var _textContent = require("../text-content");
/**
 * Matches the given instance's text content against string or regex matcher.
 *
 * @param instance - Instance which text content will be matched
 * @param text - The string or regex to match.
 * @returns - Whether the instance's text content matches the given string or regex.
 */
function matchTextContent(instance, text, options = {}) {
  const textContent = (0, _textContent.getTextContent)(instance);
  const {
    exact,
    normalizer
  } = options;
  return (0, _matches.matches)(text, textContent, normalizer, exact);
}
//# sourceMappingURL=match-text-content.js.map