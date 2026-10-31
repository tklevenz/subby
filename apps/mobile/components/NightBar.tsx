import React from 'react';
import { View } from 'react-native';

/**
 * A night as one bar: its stretches of sleep in violet and the wakings between them in amber, each as long as it
 * lasted. `stretches` are oldest first.
 */
export default function NightBar({ stretches }: { stretches: { start: number; end: number }[] }) {
  const parts: { asleep: boolean; ms: number }[] = [];
  stretches.forEach((s, i) => {
    if (i > 0) parts.push({ asleep: false, ms: s.start - stretches[i - 1]!.end });
    parts.push({ asleep: true, ms: s.end - s.start });
  });
  return (
    <View className="flex-row h-2.5 rounded-full overflow-hidden gap-0.5">
      {parts.map((part, i) => (
        <View key={i} className={part.asleep ? 'bg-violet-deep' : 'bg-amber-pale'} style={{ flex: Math.max(part.ms, 1) }} />
      ))}
    </View>
  );
}

/** A night's pieces as stretches (a running one until `now`). */
export const stretchesOf = (pieces: { startedAt: number; endedAt: number | null }[], now: number) =>
  pieces.map((p) => ({ start: p.startedAt, end: p.endedAt ?? now }));
