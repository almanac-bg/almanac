// Metro for an app that lives beside the monorepo's workspaces, not in them (its own install: React Native's React and
// tools, not the web's — CONTRIBUTING.md → Приложението). The shared code in packages/ is built from its sources, and
// whatever it imports (react, zustand, socket.io-client) is the app's own copy: one React, never two.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const app = __dirname;
const packages = path.resolve(app, '../../packages');
const config = getDefaultConfig(app);

config.watchFolders = [packages];
config.resolver.extraNodeModules = {
  '@almanac/shared': path.join(packages, 'shared'),
  '@almanac/client': path.join(packages, 'client'),
};
const resolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const next = resolve ?? context.resolveRequest;
  // `@/…`: the app's src/ (tsconfig.json says the same to the type checker; Expo's reading of it is off).
  if (moduleName.startsWith('@/')) return next(context, path.join(app, 'src', moduleName.slice(2)), platform);
  const bare = !moduleName.startsWith('.') && !moduleName.startsWith('/') && !moduleName.startsWith('@almanac/');
  // A package that packages/ imports is looked for from the app, as if the app had imported it.
  const fromPackages = bare && context.originModulePath.startsWith(packages + path.sep);
  const from = fromPackages ? { ...context, originModulePath: path.join(app, 'package.json') } : context;
  return next(from, moduleName, platform);
};

module.exports = config;
