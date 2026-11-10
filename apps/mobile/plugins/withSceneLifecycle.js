// iOS 27 SDK: apps must adopt the UIScene life cycle, or UIKit traps at launch
// (UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption). Expo SDK 57's template doesn't yet; SDK 58's does,
// with Expo's own ExpoAppSceneDelegate (already shipped in the expo package we use). This backports that:
// - Info.plist: a scene manifest whose delegate is ExpoAppSceneDelegate (by its Objective-C name), which creates the
//   window, starts React Native in it and forwards scene events (URLs, activities) to the app delegate;
// - AppDelegate.swift: provides the React Native factory (ExpoReactNativeFactoryProvider) and no longer creates the
//   window itself.
// Remove this plugin when moving to Expo SDK 58, whose template does the same.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
    ],
  },
};

// The SDK 57 template creates the window and starts React Native in didFinishLaunching; the scene delegate does that now.
const WINDOW_START = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return c;
  });
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') throw new Error('withSceneLifecycle: expected a Swift AppDelegate');
    let src = c.modResults.contents;
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    }
    src = src.replace(WINDOW_START, '\n    // The scene delegate (Info.plist) creates the window and starts React Native.\n');
    if (!src.includes('ExpoReactNativeFactoryProvider') || src.includes('UIWindow(frame: UIScreen.main.bounds)')) {
      throw new Error('withSceneLifecycle: AppDelegate.swift no longer matches the SDK 57 template; check the plugin');
    }
    c.modResults.contents = src;
    return c;
  });
};
