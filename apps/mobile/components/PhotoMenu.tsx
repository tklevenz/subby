import React, { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
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
    { label: 'Take photo', icon: <Camera color={colors.inkSoft} size={18} />, onPress: () => pick('camera') },
    { label: 'Choose from library', icon: <ImageIcon color={colors.inkSoft} size={18} />, onPress: () => pick('library') },
    ...(hasPhoto
      ? [{ label: 'Remove photo', icon: <TrashCan color={colors.redStrong} size={18} />, onPress: () => after(() => onChange(null)), danger: true }]
      : []),
  ];

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} onDismiss={runPending}>
      <Pressable className="flex-1 bg-scrim/60 justify-end px-4 pb-10" onPress={onClose}>
        <View className="bg-surface rounded-2xl border border-line-strong overflow-hidden">
          {items.map((item) => (
            <Pressable key={item.label} onPress={item.onPress} className="flex-row items-center px-4 py-4 border-b border-line">
              {item.icon}
              <Text className={`ml-3 text-base ${'danger' in item ? 'text-red-soft' : 'text-ink'}`}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} className="px-4 py-4 items-center">
            <Text className="text-ink-muted text-base">Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
