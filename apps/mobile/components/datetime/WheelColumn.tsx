import React, { useEffect, useRef } from 'react';
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent, View } from 'react-native';
import * as Haptics from 'expo-haptics';

export const ITEM_HEIGHT = 44;
/** Rows visible at once; the middle one is selected. */
export const VISIBLE_ROWS = 5;
const PAD = ITEM_HEIGHT * Math.floor(VISIBLE_ROWS / 2);

/**
 * One snapping wheel (a day, an hour, a minute…). The selected row sits in the middle; rows further away fade
 * and shrink. Drawn in JS so it looks the same on iOS and Android.
 */
export default function WheelColumn({
  labels,
  index,
  onChange,
  width,
  align = 'center',
}: {
  labels: string[];
  index: number;
  onChange: (index: number) => void;
  width?: number;
  align?: 'left' | 'center' | 'right';
}) {
  const scrollY = useRef(new Animated.Value(index * ITEM_HEIGHT)).current;
  const list = useRef<Animated.FlatList<string>>(null);
  const current = useRef(index);

  // Follow outside changes (e.g. the day of month clamped when the month gets shorter).
  useEffect(() => {
    if (index === current.current) return;
    current.current = index;
    list.current?.scrollToOffset({ offset: index * ITEM_HEIGHT, animated: true });
  }, [index]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT)));
    if (i === current.current) return;
    current.current = i;
    Haptics.selectionAsync();
    onChange(i);
  };

  return (
    <View style={{ height: ITEM_HEIGHT * VISIBLE_ROWS, width, flex: width ? undefined : 1 }}>
      <Animated.FlatList
        ref={list}
        data={labels}
        keyExtractor={(_, i) => String(i)}
        getItemLayout={(_, i) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * i, index: i })}
        initialScrollIndex={index}
        contentContainerStyle={{ paddingVertical: PAD }}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        onMomentumScrollEnd={settle}
        // A slow drag that ends without a fling has no momentum phase.
        onScrollEndDrag={(e) => {
          if (Math.abs(e.nativeEvent.velocity?.y ?? 0) < 0.05) settle(e);
        }}
        initialNumToRender={VISIBLE_ROWS + 4}
        windowSize={7}
        renderItem={({ item, index: i }) => {
          const range = [(i - 2) * ITEM_HEIGHT, i * ITEM_HEIGHT, (i + 2) * ITEM_HEIGHT];
          const opacity = scrollY.interpolate({ inputRange: range, outputRange: [0.25, 1, 0.25], extrapolate: 'clamp' });
          const scale = scrollY.interpolate({ inputRange: range, outputRange: [0.82, 1, 0.82], extrapolate: 'clamp' });
          return (
            <Animated.Text
              className="text-ink text-[22px]"
              style={{ height: ITEM_HEIGHT, lineHeight: ITEM_HEIGHT, textAlign: align, opacity, transform: [{ scale }], fontVariant: ['tabular-nums'] }}
              numberOfLines={1}
            >
              {item}
            </Animated.Text>
          );
        }}
      />
    </View>
  );
}
