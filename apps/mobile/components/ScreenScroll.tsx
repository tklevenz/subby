import React from 'react';
import { ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * A screen's scrolling body: its bottom padding grows by the system bar's height (Android's navigation bar,
 * the iPhone's home indicator), so the last button never ends up underneath it. Defaults to the screen look: the
 * ground color and a 16 gutter (40 at the bottom); pass `className` or `contentContainerStyle` for a different one.
 */
export function ScreenScroll({ contentContainerStyle = { padding: 16, paddingBottom: 40 }, className = 'flex-1 bg-ground', ...props }: ScrollViewProps) {
  const insets = useSafeAreaInsets();
  const style = StyleSheet.flatten(contentContainerStyle) ?? {};
  const bottom = typeof style.paddingBottom === 'number' ? style.paddingBottom : 0;
  return <ScrollView {...props} className={className} contentContainerStyle={[style, { paddingBottom: bottom + insets.bottom }]} />;
}

/** The same for lists (FlatList): the bottom padding to use. */
export function useScreenBottom(padding = 40) {
  return padding + useSafeAreaInsets().bottom;
}
