import { configDefaults, defineConfig } from 'vitest/config';

// ios/ and android/ are generated; Xcode checks out Swift packages (with their own JS tests) under ios/build.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'ios/**', 'android/**'] },
});
