"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.findAll = findAll;
var _config = require("../config");
var _accessibility = require("./accessibility");
function findAll(root, predicate, options = {}) {
  const {
    matchDeepestOnly
  } = options;
  const results = root.queryAll(predicate, {
    matchDeepestOnly
  });
  const includeHiddenElements = options?.includeHiddenElements ?? options?.hidden ?? (0, _config.getConfig)()?.defaultIncludeHiddenElements;
  if (includeHiddenElements) {
    return results;
  }
  const cache = new WeakMap();
  return results.filter(instance => !(0, _accessibility.isHiddenFromAccessibility)(instance, {
    cache
  }));
}
//# sourceMappingURL=find-all.js.map