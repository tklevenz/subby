import { t } from '@subby/shared/i18n';
import React, { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Camera, ImageIcon, TrashCan } from './icons';
import { pickPhoto } from '../features/photos';
import { colors } from '../theme/colors';

/**
 * Take / choose / remove photo menu (a modal, since Android alerts allow only 3 buttons).
 * `onChange` receives the new photo uri, or null when removed.
 */
export default function PhotoMenu({
  visible,
  hasPhoto,
  onClose,
  onChange,
}: {
  visible: boolean;
  hasPhoto: boolean;
  onClose: () => void;
  onChange: (uri: string | null) => void;
}) {
  // iOS can't present the picker while this modal is still dismissing, so actions run
  // after it has closed (onDismiss on iOS; Android has no such constraint).
  const pending = useRef<(() => void) | null>(null);
  const runPending = () => {
    const action = pending.current;
    pending.current = null;
    action?.();
  };
  useEffect(() => {
    if (!visible && Platform.OS !== 'ios') runPending();
  }, [visible]);

  const after = (action: () => void) => {
    pending.current = action;
    onClose();
  };
  const pick = (source: 'camera' | 'library') =>
    after(async () => {
      const uri = await pickPhoto(source, true);
      if (uri) onChange(uri);
    });

  const items = [
    { label: t('photoMenu.take'), icon: <Camera color={colors.inkSoft} size={18} />, onPress: () => pick('camera') },
    { label: t('photoMenu.choose'), icon: <ImageIcon color={colors.inkSoft} size={18} />, onPress: () => pick('library') },
    ...(hasPhoto
      ? [{ label: t('photoMenu.remove'), icon: <TrashCan color={colors.redStrong} size={18} />, onPress: () => after(() => onChange(null)), danger: true }]
      : []),
  ];

  const reduced = useReducedMotion();
  return (
    <Modal transparent visible={visible} animationType={reduced ? 'none' : 'fade'} onRequestClose={onClose} onDismiss={runPending}>
      <View className="flex-1 justify-end px-4 pb-10">
        <Pressable onPress={onClose} accessible={false} importantForAccessibility="no" className="absolute inset-0 bg-scrim/60" />
        <View accessibilityViewIsModal onAccessibilityEscape={onClose} className="bg-surface rounded-2xl border border-line-strong overflow-hidden">
          {items.map((item) => (
            <Pressable key={item.label} onPress={item.onPress} accessibilityRole="button" className="flex-row items-center px-4 py-4 border-b border-line">
              {item.icon}
              <Text className={`ml-3 text-base ${'danger' in item ? 'text-red-soft' : 'text-ink'}`}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} accessibilityRole="button" className="px-4 py-4 items-center">
            <Text className="text-ink-muted text-base">{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
