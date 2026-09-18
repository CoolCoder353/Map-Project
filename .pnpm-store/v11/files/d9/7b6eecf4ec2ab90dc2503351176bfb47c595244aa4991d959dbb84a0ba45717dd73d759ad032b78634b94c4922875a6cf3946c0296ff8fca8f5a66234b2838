"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.configure = configure;
exports.getConfig = getConfig;
exports.resetToDefaults = resetToDefaults;
var _validateOptions = require("./helpers/validate-options");
/**
 * Global configuration options for React Native Testing Library.
 */

const defaultConfig = {
  asyncUtilTimeout: 1000,
  defaultIncludeHiddenElements: false
};
let config = {
  ...defaultConfig
};

/**
 * Configure global options for React Native Testing Library.
 */
function configure(options) {
  const {
    asyncUtilTimeout,
    defaultDebugOptions,
    defaultHidden,
    defaultIncludeHiddenElements,
    ...rest
  } = options;
  (0, _validateOptions.validateOptions)('configure', rest, configure);
  const resolvedDefaultIncludeHiddenElements = defaultIncludeHiddenElements ?? defaultHidden ?? config.defaultIncludeHiddenElements;
  config = {
    ...config,
    asyncUtilTimeout: asyncUtilTimeout ?? config.asyncUtilTimeout,
    defaultDebugOptions,
    defaultIncludeHiddenElements: resolvedDefaultIncludeHiddenElements
  };
}
function resetToDefaults() {
  config = {
    ...defaultConfig
  };
}
function getConfig() {
  return config;
}
//# sourceMappingURL=config.js.map