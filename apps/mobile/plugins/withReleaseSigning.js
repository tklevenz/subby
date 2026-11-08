const { withAppBuildGradle } = require('expo/config-plugins');

// Signs Android release builds with our upload key instead of the debug key, when a keystore properties file is
// given at prebuild time (SUBBY_SIGNING=/path/to/upload.properties). Without it, release builds keep the debug key
// (local test builds). The file stays outside the repo and is read by Gradle at build time, so no password ends up
// in android/:
//   storeFile=/absolute/path/to/subby-upload.jks
//   storePassword=…
//   keyAlias=upload
//   keyPassword=…
const MARKER = '// subby-release-signing';

module.exports = function withReleaseSigning(config, propertiesFile) {
  if (!propertiesFile) return config;
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;
    const release = [
      `        release { ${MARKER}`,
      `            def props = new Properties()`,
      `            file(${JSON.stringify(propertiesFile)}).withInputStream { props.load(it) }`,
      `            storeFile file(props['storeFile'])`,
      `            storePassword props['storePassword']`,
      `            keyAlias props['keyAlias']`,
      `            keyPassword props['keyPassword']`,
      `        }`,
    ].join('\n');
    const withConfig = gradle.replace(/signingConfigs \{\n/, (m) => `${m}${release}\n`);
    const withBuildType = withConfig.replace(
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release',
    );
    if (withConfig === gradle || withBuildType === withConfig) {
      throw new Error('withReleaseSigning: build.gradle has an unexpected shape; update the plugin');
    }
    cfg.modResults.contents = withBuildType;
    return cfg;
  });
};
