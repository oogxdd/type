// Metro config for the npm-workspaces monorepo: watch the whole repo so
// @typenotes/shared and @typenotes/mobile-core (TS source packages) rebuild
// on change, and resolve modules from both node_modules trees.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
