import { t } from '@subby/shared/i18n';
import { Alert } from 'react-native';

/** Asks before something that can't be undone: a cancel button and a red `action` that runs `onConfirm`. */
export function confirmDestructive({
  title,
  text,
  action,
  cancel = t('common.cancel'),
  onConfirm,
}: {
  title: string;
  text?: string;
  /** The red button's label ("Delete"). */
  action: string;
  /** The other button's label, when "Cancel" doesn't fit ("Keep"). */
  cancel?: string;
  onConfirm: () => void | Promise<void>;
}) {
  Alert.alert(title, text, [
    { text: cancel, style: 'cancel' },
    { text: action, style: 'destructive', onPress: () => void onConfirm() },
  ]);
}
