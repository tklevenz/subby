import { t } from '@subby/shared/i18n';
import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';

/**
 * Asks "Discard changes?" when the screen is left (back button, swipe, Android's back) while `dirty`. Returns
 * `leave`: call it right before navigating away on purpose (after saving or deleting), so that isn't asked.
 */
export function useConfirmDiscard(dirty: boolean): () => void {
  const navigation = useNavigation();
  const leaving = useRef(false);
  usePreventRemove(dirty, ({ data }) => {
    if (leaving.current) return navigation.dispatch(data.action);
    Alert.alert(t('discard.title'), t('discard.text'), [
      { text: t('discard.keep'), style: 'cancel' },
      { text: t('discard.discard'), style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  return useCallback(() => {
    leaving.current = true;
  }, []);
}
