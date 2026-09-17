// Monorepo-aware Metro config: resolve workspace packages' TypeScript sources via the
// "development" export condition (see packages/*/package.json).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['development', 'react-native', 'require', 'default'];

// Workspace sources use NodeNext-style "./file.js" specifiers for TypeScript files.
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  if (moduleName.startsWith('.') && moduleName.endsWith('.js') && context.originModulePath.includes('/packages/')) {
    try {
      return resolve(context, moduleName.slice(0, -3), platform);
    } catch {
      // fall through to the original specifier
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
