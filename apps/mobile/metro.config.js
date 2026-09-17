// Monorepo-aware Metro config: resolve workspace packages' TypeScript sources via the
// "development" export condition (see packages/*/package.json).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['development', 'react-native', 'require', 'default'];
module.exports = config;
