// Background tasks must be defined before anything else runs: a headless background launch (periodic sync,
// a "sync now" push) loads this entry without rendering any screen.
import './features/sync/background';
import 'expo-router/entry';
