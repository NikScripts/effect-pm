/**
 * Expo monorepo + pnpm: bob packages (e.g. react-native-marked) ship a
 * `"react-native": "src/index"` entry and import peer deps like
 * `react-native-svg`. Isolated pnpm layouts sometimes leave Metro unable to
 * walk from that nested `.pnpm/.../src` file to the peer, even when the app
 * declares the dependency. Force those peers through the app's install.
 *
 * @see https://docs.expo.dev/guides/monorepos/
 */
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const peerPackages = ["react-native-svg"];

const peerRoots = Object.fromEntries(
  peerPackages.map((name) => {
    const pkgJson = require.resolve(`${name}/package.json`, {
      paths: [projectRoot],
    });
    return [name, path.dirname(pkgJson)];
  }),
);

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  ...peerRoots,
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const peerRoot = peerPackages.find(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  if (peerRoot !== undefined) {
    const filePath = require.resolve(moduleName, { paths: [projectRoot] });
    return { type: "sourceFile", filePath };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
