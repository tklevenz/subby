import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

export const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Loads a native module that may not exist where the app runs (Expo Go), or null. Call it with a `require` in the
 * callback (`optionalModule(() => require('x') as typeof X)`): Metro needs the literal there, and a static import
 * would crash on load.
 *
 * `skipIn` says where to skip without trying: `'expo-go'` (any platform: expo-task-manager, expo-background-task
 * and expo-notifications' push parts aren't there) or `'expo-go-android'` (expo-notifications' local scheduling
 * works in Expo Go on iOS, so reminders keep working there; on Android the import itself crashes).
 */
export function optionalModule<T>(load: () => T, skipIn: 'expo-go' | 'expo-go-android'): T | null {
  if (inExpoGo && (skipIn === 'expo-go' || Platform.OS === 'android')) return null;
  try {
    return load();
  } catch {
    return null;
  }
}
