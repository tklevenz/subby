import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Xmark } from './icons';
import { colors } from '../theme/colors';

/** Drag this far down (or flick faster than FLICK_VELOCITY) to close; less springs back. */
const CLOSE_DISTANCE = 120;
const FLICK_VELOCITY = 0.8;

/**
 * Slide-up modal sheet with drag handle, title row and scrollable body. The handle and title row drag it down to
 * close; the body doesn't, so scrolling and the wheels never fight the gesture.
 */
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

  /** Moves the sheet to `toValue` (0 is open, `height` is away). */
  const slideTo = (toValue: number, duration: number, easing?: (t: number) => number, done?: () => void) =>
    Animated.timing(slideY, { toValue, duration, easing, useNativeDriver: true }).start(done);
  const settle = () => slideTo(0, 180, Easing.out(Easing.cubic));

  useEffect(() => {
    if (!visible) return;
    slideY.setValue(height);
    // Not a spring: an underdamped one overshot and then crept to rest for most of a second, and a tap landing while
    // the sheet still moved under the finger was cancelled (the Diaper sheet's "first tap does nothing").
    slideTo(0, 240, Easing.out(Easing.cubic));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slideTo only closes over slideY, which is stable
  }, [visible, slideY, height]);

  const dismiss = () => slideTo(height, 220, undefined, onClose);

  // Claims the touch at its start: asked only on a move, the strip never got it (seen on Android, New
  // Architecture). The ✕ still gets its taps, since the deepest view is asked first. A plain tap on the strip
  // just springs back. Refs: the responder is made once, `dismiss` changes.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => slideY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > CLOSE_DISTANCE || g.vy > FLICK_VELOCITY) dismissRef.current();
        else settleRef.current();
      },
      onPanResponderTerminate: () => settleRef.current(),
    }),
  ).current;

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent onRequestClose={dismiss}>
      <KeyboardAvoidingView className="flex-1 justify-end" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable onPress={dismiss} className="absolute inset-0 bg-scrim/60" />

        <Animated.View
          style={{ transform: [{ translateY: slideY }], maxHeight: height * 0.9 }}
          className="bg-surface border-t border-line-strong/50 rounded-t-2xl"
        >
          <View {...drag.panHandlers}>
            <View className="items-center pt-3 pb-1">
              <View className="w-10 h-1.5 bg-raised-top rounded-full" />
            </View>

            <View className="flex-row items-center justify-between px-5 pb-2">
              <View className="flex-row items-center">
                {icon}
                <Text className="text-lg font-bold text-ink ml-2">{title}</Text>
              </View>
              <Pressable onPress={dismiss} hitSlop={10}>
                <Xmark color={colors.inkMuted} size={22} />
              </Pressable>
            </View>
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
