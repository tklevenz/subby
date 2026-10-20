import React, { useEffect, useRef } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { colors } from '../theme/colors';

/** Slide-up modal sheet with drag handle, title row and scrollable body. */
export default function BottomSheet({
  visible,
  onClose,
  title,
  icon,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const slideY = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    if (!visible) return;
    slideY.setValue(height);
    Animated.spring(slideY, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 200 }).start();
  }, [visible, slideY, height]);

  const dismiss = () =>
    Animated.timing(slideY, { toValue: height, duration: 220, useNativeDriver: true }).start(() => onClose());

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent onRequestClose={dismiss}>
      <KeyboardAvoidingView className="flex-1 justify-end" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable onPress={dismiss} className="absolute inset-0 bg-scrim/60" />

        <Animated.View
          style={{ transform: [{ translateY: slideY }], maxHeight: height * 0.9 }}
          className="bg-surface border-t border-line-strong/50 rounded-t-2xl"
        >
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1.5 bg-raised-top rounded-full" />
          </View>

          <View className="flex-row items-center justify-between px-5 pb-2">
            <View className="flex-row items-center">
              {icon}
              <Text className="text-lg font-bold text-ink ml-2">{title}</Text>
            </View>
            <Pressable onPress={dismiss} hitSlop={10}>
              <X color={colors.inkMuted} size={22} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 16 }}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
