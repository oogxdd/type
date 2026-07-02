module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated v4: the worklets plugin must be last.
    plugins: ["react-native-worklets/plugin"],
  };
};
