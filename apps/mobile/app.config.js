const fs = require('node:fs');
const path = require('node:path');

// Extends app.json.
// - KINDRED_ALLOW_HTTP=1 builds an app that may talk to plain-HTTP sync servers (a LAN server without a domain
//   yet). Release builds otherwise only allow HTTPS; never ship a store build with this set.
//     KINDRED_ALLOW_HTTP=1 npx expo prebuild --clean --platform android && (cd android && ./gradlew assembleRelease)
// - google-services.json (the Firebase project's Android config, not in git) enables push: the app gets an FCM
//   token, and servers holding that project's service-account key can wake it. Without it, there's no push.
module.exports = ({ config }) => {
  const plugins = [...config.plugins];
  if (process.env.KINDRED_ALLOW_HTTP === '1') plugins.push(['expo-build-properties', { android: { usesCleartextTraffic: true } }]);
  const googleServices = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  const android = fs.existsSync(path.resolve(__dirname, googleServices)) ? { ...config.android, googleServicesFile: googleServices } : config.android;
  return { ...config, android, plugins };
};
