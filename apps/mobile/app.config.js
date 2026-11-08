const fs = require('node:fs');
const path = require('node:path');
const withReleaseSigning = require('./plugins/withReleaseSigning');

// Extends app.json.
// - SUBBY_ALLOW_HTTP=1 builds an app that may talk to plain-HTTP sync servers (a LAN server without a domain
//   yet). Release builds otherwise only allow HTTPS; never ship a store build with this set.
//     SUBBY_ALLOW_HTTP=1 npx expo prebuild --clean --platform android && (cd android && ./gradlew assembleRelease)
// - google-services.json (the Firebase project's Android config, not in git) enables push: the app gets an FCM
//   token, and servers holding that project's service-account key can wake it. Without it, or when it has no
//   client for this package id, there's no push.
// - SUBBY_SIGNING=/path/to/upload.properties signs release builds with the upload key (plugins/withReleaseSigning).
function hasClientFor(file, pkg) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return json.client.some((c) => c.client_info?.android_client_info?.package_name === pkg);
  } catch {
    return false;
  }
}

module.exports = ({ config }) => {
  const plugins = [...config.plugins];
  if (process.env.SUBBY_ALLOW_HTTP === '1') plugins.push(['expo-build-properties', { android: { usesCleartextTraffic: true } }]);
  const googleServices = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  const googleServicesPath = path.resolve(__dirname, googleServices);
  let android = config.android;
  if (fs.existsSync(googleServicesPath)) {
    if (hasClientFor(googleServicesPath, android.package)) android = { ...android, googleServicesFile: googleServices };
    else console.warn(`app.config.js: ${googleServices} has no Android app ${android.package}; building without push`);
  }
  const signing = process.env.SUBBY_SIGNING ? path.resolve(process.env.SUBBY_SIGNING) : undefined;
  return withReleaseSigning({ ...config, android, plugins }, signing);
};
