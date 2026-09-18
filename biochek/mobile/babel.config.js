module.exports = function (api) {
  api.cache(true);
  return {
    // Expo SDK 57's default preset. react-native-reanimated (and its Babel
    // plugin) were removed once Task 12's rewrite stopped using worklets /
    // frame processors — nothing here may reference them again.
    presets: ['babel-preset-expo'],
  };
};
