import * as Haptics from 'expo-haptics';

/** After a successful save: the success tap, then `close` (the sheet or screen). */
export function savedFeedback(close: () => void) {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  close();
}
