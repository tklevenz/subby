// Extends app.json. KINDRED_ALLOW_HTTP=1 builds an app that may talk to plain-HTTP sync servers (a LAN server
// without a domain yet). Release builds otherwise only allow HTTPS; never ship a store build with this set.
//   KINDRED_ALLOW_HTTP=1 npx expo prebuild --clean --platform android && (cd android && ./gradlew assembleRelease)
module.exports = ({ config }) => {
  if (process.env.KINDRED_ALLOW_HTTP !== '1') return config;
  return {
    ...config,
    plugins: [...config.plugins, ['expo-build-properties', { android: { usesCleartextTraffic: true } }]],
  };
};
