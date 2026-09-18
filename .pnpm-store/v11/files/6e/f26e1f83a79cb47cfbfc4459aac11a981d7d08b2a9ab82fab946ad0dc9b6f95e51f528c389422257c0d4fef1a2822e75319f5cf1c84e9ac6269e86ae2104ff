"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getTextContent = getTextContent;
function getTextContent(instance) {
  if (!instance) {
    return '';
  }
  if (typeof instance === 'string') {
    return instance;
  }
  const result = [];
  instance.children?.forEach(child => {
    result.push(getTextContent(child));
  });
  return result.join('');
}
//# sourceMappingURL=text-content.js.map