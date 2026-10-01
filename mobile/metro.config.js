const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// The Bible picker reads the same World English Bible catalog the web bundles.
config.watchFolders = [
  ...new Set([
    ...(config.watchFolders ?? []),
    path.resolve(projectRoot, "../src/features/composer/data"),
    // Comment @mentions share the web's draft helpers.
    path.resolve(projectRoot, "../src/features/mentions"),
  ]),
];

module.exports = config;
