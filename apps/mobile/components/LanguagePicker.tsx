import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { LOCALES, LOCALE_NAMES, t } from '@subby/shared/i18n';
import { Check } from './icons';
import { systemLocale, type LanguageChoice } from '../features/i18n';
import { colors } from '../theme/colors';

/** The app's language: the phone's (default) or one of ours, each named in itself. */
export function languageLabel(choice: LanguageChoice): string {
  return choice === 'system' ? t('language.system', { language: LOCALE_NAMES[systemLocale()] }) : LOCALE_NAMES[choice];
}

export default function LanguagePicker({
  visible,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  value: LanguageChoice;
  onPick: (choice: LanguageChoice) => void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const choices: LanguageChoice[] = ['system', ...LOCALES];
  return (
    <Modal transparent visible={visible} animationType={reduced ? 'none' : 'fade'} onRequestClose={onClose}>
      <View onAccessibilityEscape={onClose} className="flex-1 justify-center px-8">
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          className="absolute inset-0 bg-scrim/60"
        />
        <View className="bg-surface rounded-2xl border border-line-strong overflow-hidden max-h-[80%]">
          <ScrollView>
            {choices.map((c, i) => (
              <Pressable
                key={c}
                onPress={() => onPick(c)}
                accessibilityRole="button"
                accessibilityState={{ selected: c === value }}
                className={`flex-row items-center px-4 py-3.5 ${i < choices.length - 1 ? 'border-b border-line' : ''}`}
              >
                <Text className="flex-1 text-ink text-base">{languageLabel(c)}</Text>
                {c === value ? <Check color={colors.violetStrong} size={18} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
