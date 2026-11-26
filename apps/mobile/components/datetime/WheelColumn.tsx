import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, View, type AccessibilityActionEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

export const ITEM_HEIGHT = 44;
/** Rows visible at once; the middle one is selected. */
export const VISIBLE_ROWS = 5;
const PAD = ITEM_HEIGHT * Math.floor(VISIBLE_ROWS / 2);

/**
 * One snapping wheel (a day, an hour, a minute…). The selected row sits in the middle; rows further away fade
 * and shrink; tapping a row selects it. Drawn in JS so it looks the same on iOS and Android.
 * Exposed to screen readers as a single adjustable control (swipe up/down to step).
 */
export default function WheelColumn({
  label,
  labels,
  index,
  onChange,
  width,
  align = 'center',
}: {
  /** What this wheel picks ("Day", "Hour"…), read by screen readers. */
  label: string;
  labels: string[];
  index: number;
  onChange: (index: number) => void;
  width?: number;
  align?: 'left' | 'center' | 'right';
}) {
  const reduced = useReducedMotion();
  const scrollY = useRef(new Animated.Value(index * ITEM_HEIGHT)).current;
  const list = useRef<Animated.FlatList<string>>(null);
  const current = useRef(index);
  const lastY = useRef(index * ITEM_HEIGHT);
  const momentum = useRef(false);
  const endTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Exact snap points per row: snapToInterval drifts on Android when a row isn't a whole number of pixels
  // (44 pt × 2.625 = 115.5 px), so a wheel far down could come to rest between rows.
  const offsets = useMemo(() => labels.map((_, i) => i * ITEM_HEIGHT), [labels]);

  useEffect(() => () => clearTimeout(endTimer.current), []);

  // The latest index the parent gave, for after onChange (see select).
  const given = useRef(index);
  given.current = index;

  const select = (i: number) => {
    if (i === current.current) return;
    current.current = i;
    void Haptics.selectionAsync();
    onChange(i);
    // The parent may keep its value (the 31st in February, an hour the clocks skip): then the index doesn't
    // change, nothing re-renders, and the wheel would rest on a row that isn't the value. Back to it.
    setTimeout(() => {
      if (given.current === i) return;
      current.current = given.current;
      list.current?.scrollToOffset({ offset: given.current * ITEM_HEIGHT, animated: !reduced });
    }, 50);
  };

  // Follow outside changes (e.g. the day of month clamped when the month gets shorter).
  useEffect(() => {
    if (index === current.current) return;
    current.current = index;
    list.current?.scrollToOffset({ offset: index * ITEM_HEIGHT, animated: !reduced });
  }, [index, reduced]);

  /** Once the wheel has really stopped: pick the nearest row and make sure it rests exactly on it. */
  const settle = (y: number) => {
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(y / ITEM_HEIGHT)));
    if (Math.abs(y - i * ITEM_HEIGHT) > 0.5) list.current?.scrollToOffset({ offset: i * ITEM_HEIGHT, animated: !reduced });
    select(i);
  };

  const tap = (i: number) => {
    list.current?.scrollToOffset({ offset: i * ITEM_HEIGHT, animated: !reduced });
    select(i);
  };

  const onAction = (e: AccessibilityActionEvent) => {
    const step = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
    if (!step) return;
    const next = Math.max(0, Math.min(labels.length - 1, index + step));
    if (next !== index) tap(next);
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: labels[index] ?? '' }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAction}
      style={{ height: ITEM_HEIGHT * VISIBLE_ROWS, width, flex: width ? undefined : 1 }}
    >
      <Animated.FlatList
        ref={list}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        data={labels}
        keyExtractor={(_, i) => String(i)}
        getItemLayout={(_, i) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * i, index: i })}
        initialScrollIndex={index}
        contentContainerStyle={{ paddingVertical: PAD }}
        showsVerticalScrollIndicator={false}
        snapToOffsets={offsets}
        decelerationRate="fast"
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
            lastY.current = e.nativeEvent.contentOffset.y;
          },
        })}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          clearTimeout(endTimer.current);
          momentum.current = false;
        }}
        // Let go without a flick: there may be no momentum phase, so settle shortly after unless one starts.
        onScrollEndDrag={(e) => {
          lastY.current = e.nativeEvent.contentOffset.y;
          clearTimeout(endTimer.current);
          endTimer.current = setTimeout(() => {
            if (!momentum.current) settle(lastY.current);
          }, 150);
        }}
        onMomentumScrollBegin={() => {
          momentum.current = true;
          clearTimeout(endTimer.current);
        }}
        onMomentumScrollEnd={(e) => {
          momentum.current = false;
          settle(e.nativeEvent.contentOffset.y);
        }}
        initialNumToRender={VISIBLE_ROWS + 4}
        windowSize={7}
        renderItem={({ item, index: i }) => {
          const range = [(i - 2) * ITEM_HEIGHT, i * ITEM_HEIGHT, (i + 2) * ITEM_HEIGHT];
          const opacity = scrollY.interpolate({ inputRange: range, outputRange: [0.25, 1, 0.25], extrapolate: 'clamp' });
          const scale = scrollY.interpolate({ inputRange: range, outputRange: [0.82, 1, 0.82], extrapolate: 'clamp' });
          return (
            <Pressable onPress={() => tap(i)} accessible={false}>
              <Animated.Text
                className="text-ink text-[22px]"
                style={{ height: ITEM_HEIGHT, lineHeight: ITEM_HEIGHT, textAlign: align, opacity, transform: [{ scale }], fontVariant: ['tabular-nums'] }}
                numberOfLines={1}
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.35}
              >
                {item}
              </Animated.Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
