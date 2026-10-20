import React, { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { Camera, ImagePlus, Trash2 } from 'lucide-react-native';
import { pickPhoto } from '../features/photos';

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
    { label: 'Take photo', icon: <Camera color="#cbd5e1" size={18} />, onPress: () => pick('camera') },
    { label: 'Choose from library', icon: <ImagePlus color="#cbd5e1" size={18} />, onPress: () => pick('library') },
    ...(hasPhoto
      ? [{ label: 'Remove photo', icon: <Trash2 color="#f87171" size={18} />, onPress: () => after(() => onChange(null)), danger: true }]
      : []),
  ];

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} onDismiss={runPending}>
      <Pressable className="flex-1 bg-black/60 justify-end px-4 pb-10" onPress={onClose}>
        <View className="bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden">
          {items.map((item) => (
            <Pressable key={item.label} onPress={item.onPress} className="flex-row items-center px-4 py-4 border-b border-slate-800">
              {item.icon}
              <Text className={`ml-3 text-base ${'danger' in item ? 'text-red-300' : 'text-white'}`}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} className="px-4 py-4 items-center">
            <Text className="text-slate-400 text-base">Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
