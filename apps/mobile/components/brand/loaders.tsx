// `tr`: `t` is the animation's progress in here.
import { t as tr } from '@subby/shared/i18n';
import React, { useEffect, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { colors } from '../../theme/colors';
import { Periscope, Sub, SUB_VIEWBOX } from './Sub';

// Loaders with the sub from the app icon. With reduced motion turned on they stand still.

// Created once: `useLoop` restarts when its easing changes, and Home redraws every second for its timers.
const SWAY = Easing.inOut(Easing.sin);
const RISE = Easing.out(Easing.quad);

/** A shared value running 0 → 1 on repeat (back and forth with `reverse`), from `delay` ms. */
function useLoop(duration: number, { reverse = false, delay = 0, easing = Easing.linear } = {}) {
  const t = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    // From 0, so a restart can't begin at the end and repeat 1 → 1.
    t.value = 0;
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing }), -1, reverse));
    return () => cancelAnimation(t);
  }, [reduced, duration, reverse, delay, easing, t]);
  return t;
}

/** Bob: up and down with a slight roll. */
function useBob() {
  const t = useLoop(1300, { reverse: true, easing: SWAY });
  return { t, reduced: useReducedMotion() };
}

function Bubble({ x, y, r, delay }: { x: number; y: number; r: number; delay: number }) {
  const t = useLoop(2400, { delay, easing: RISE });
  const reduced = useReducedMotion();
  const style = useAnimatedStyle(() => ({
    opacity: reduced ? 0.6 : interpolate(t.value, [0, 0.15, 1], [0, 0.85, 0]),
    transform: [{ translateY: -36 * t.value }],
  }));
  return (
    <Animated.View
      style={[{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r, borderWidth: 1.5, borderColor: colors.subBubble }, style]}
    />
  );
}

/** The general loader: the sub bobbing while bubbles rise. */
export function SubLoader({ width = 112 }: { width?: number }) {
  const { t } = useBob();
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: 6 * t.value }, { rotate: `${-3 + 6 * t.value}deg` }],
  }));
  const s = width / 100;
  return (
    <View style={{ width, height: width * 0.9 }} accessibilityRole="progressbar" accessibilityLabel={tr('loader.loading')}>
      <Bubble x={84 * s} y={30 * s} r={3 * s} delay={0} />
      <Bubble x={91 * s} y={36 * s} r={2.2 * s} delay={800} />
      <Bubble x={80 * s} y={38 * s} r={1.8 * s} delay={1600} />
      <Animated.View style={[{ position: 'absolute', left: 6 * s, top: 22 * s }, style]}>
        <Sub width={width * 0.88} />
      </Animated.View>
    </View>
  );
}

function Z({ x, y, size, delay }: { x: number; y: number; size: number; delay: number }) {
  const t = useLoop(3000, { delay, easing: RISE });
  const reduced = useReducedMotion();
  const style = useAnimatedStyle(() => ({
    opacity: reduced ? 0.6 : interpolate(t.value, [0, 0.25, 1], [0, 0.9, 0]),
    transform: [{ translateX: 14 * t.value }, { translateY: -34 * t.value }, { scale: 0.7 + 0.45 * t.value }],
  }));
  return <Animated.Text style={[{ position: 'absolute', left: x, top: y, fontSize: size, fontWeight: '700', color: colors.subBubble }, style]}>z</Animated.Text>;
}

/** The sub asleep: bobbing slowly while z's drift up (and bubbles rise, when there's room). Home's running sleep. */
export function DozingSub({ width, bubbles = true }: { width: number; bubbles?: boolean }) {
  const { t } = useBob();
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: 5 * t.value }, { rotate: `${-3 + 6 * t.value}deg` }],
  }));
  const height = (width * SUB_VIEWBOX.h) / SUB_VIEWBOX.w;
  const z = Math.max(10, width * 0.14);
  return (
    <View style={{ width, height }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bubbles ? (
        <>
          <Bubble x={width * 0.04} y={height * 0.6} r={3} delay={300} />
          <Bubble x={-width * 0.04} y={height * 0.68} r={2.2} delay={1400} />
        </>
      ) : null}
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, style]}>
        <Sub width={width} />
      </Animated.View>
      <Z x={width * 0.62} y={-z * 0.4} size={z} delay={0} />
      <Z x={width * 0.74} y={-z} size={z * 0.75} delay={1100} />
      {bubbles ? <Z x={width * 0.55} y={0} size={z * 0.65} delay={2100} /> : null}
    </View>
  );
}

/** Waiting on the other phone: up periscope, look left and right. */
export function PeriscopeLoader({ width = 112 }: { width?: number }) {
  const t = useLoop(4000);
  const s = width / SUB_VIEWBOX.w;
  const up = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(t.value, [0, 0.2, 0.8, 1], [11, 0, 0, 11]) * s }] }));
  const look = useAnimatedStyle(() => ({ transform: [{ scaleX: interpolate(t.value, [0, 0.35, 0.45, 0.65, 0.75, 1], [1, 1, -1, -1, 1, 1]) }] }));
  // The periscope's box is centered on its pole (x 54), so flipping it turns it around the pole.
  return (
    <View style={{ width, height: SUB_VIEWBOX.h * s }} accessibilityRole="progressbar" accessibilityLabel={tr('loader.waiting')}>
      <Animated.View style={[{ position: 'absolute', left: (46 - SUB_VIEWBOX.x) * s, top: 0 }, up]}>
        <Animated.View style={look}>
          <Svg width={16 * s} height={26 * s} viewBox="46 16 16 26">
            <Periscope />
          </Svg>
        </Animated.View>
      </Animated.View>
      <View style={{ position: 'absolute', left: 0, top: 0 }}>
        <Sub width={width} periscope={false} />
      </View>
    </View>
  );
}

/** A small spinner: the sub circling. For buttons, rows and short waits. */
export function SubSpinner({ size = 24 }: { size?: number }) {
  const t = useLoop(1600);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${360 * t.value}deg` }] }));
  const sub = size * 0.5;
  return (
    <Animated.View style={[{ width: size, height: size }, style]} accessibilityRole="progressbar" accessibilityLabel={tr('loader.loading')}>
      <View style={{ position: 'absolute', top: 0, left: (size - sub) / 2 }}>
        <Sub width={sub} />
      </View>
    </Animated.View>
  );
}

/** Progress from 0 to 1: the sub travels along the bar. */
export function SubProgress({ progress }: { progress: number }) {
  const [track, setTrack] = useState(0);
  const p = useSharedValue(progress);
  const { t } = useBob();
  useEffect(() => {
    p.value = withTiming(Math.min(1, Math.max(0, progress)), { duration: 300 });
  }, [progress, p]);
  const subWidth = 44;
  const fill = useAnimatedStyle(() => ({ width: track * p.value }));
  const sub = useAnimatedStyle(() => ({
    transform: [{ translateX: (track - subWidth) * p.value }, { translateY: -2 * t.value }],
  }));
  return (
    <View className="self-stretch" style={{ height: 44 }} onLayout={(e: LayoutChangeEvent) => setTrack(e.nativeEvent.layout.width)}>
      <View className="absolute left-0 right-0 bg-raised rounded-full" style={{ bottom: 4, height: 6 }} />
      <Animated.View className="absolute left-0 rounded-full" style={[{ bottom: 4, height: 6, backgroundColor: colors.subAmber }, fill]} />
      <Animated.View style={[{ position: 'absolute', left: 0, bottom: 8 }, sub]}>
        <Sub width={subWidth} />
      </Animated.View>
    </View>
  );
}

function Ring({ t, size }: { t: SharedValue<number>; size: number }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.9, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.4, 1.6]) }],
  }));
  return (
    <Animated.View
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: colors.subBubble }, style]}
    />
  );
}

/** In sync: two sonar rings, once. Give it a new `key` to ping again. */
export function SyncPing({ size = 24 }: { size?: number }) {
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    a.value = withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) });
    b.value = withDelay(500, withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }));
  }, [reduced, a, b]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {reduced ? null : (
        <>
          <Ring t={a} size={size} />
          <Ring t={b} size={size} />
        </>
      )}
      <Sub width={size * 0.8} />
    </View>
  );
}
