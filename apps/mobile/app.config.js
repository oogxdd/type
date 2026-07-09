/**
 * Dynamic Expo config with APP_VARIANT support.
 *
 * Production (default): bundle ID com.typenotes.mobile, name "Type".
 * Dev (APP_VARIANT=dev): bundle ID com.typenotes.mobile.dev, name "Type Dev".
 *
 * The dev variant installs alongside the TestFlight production build on the
 * same device — they use separate data containers and appear as separate apps.
 *
 * Usage:
 *   # Production prebuild (TestFlight):
 *   npx expo prebuild --platform ios --clean
 *
 *   # Dev prebuild (device development):
 *   APP_VARIANT=dev npx expo prebuild --platform ios --clean
 */
export default ({ config }) => {
  const isDev = process.env.APP_VARIANT === "dev";

  return {
    ...config,
    name: isDev ? "Type Dev" : config.name,
    ios: {
      ...config.ios,
      bundleIdentifier: isDev
        ? "com.typenotes.mobile.dev"
        : config.ios?.bundleIdentifier,
    },
    android: {
      ...config.android,
      package: isDev
        ? "com.typenotes.mobile.dev"
        : config.android?.package,
    },
  };
};
