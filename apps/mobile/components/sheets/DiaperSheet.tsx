import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check, type IconProps } from '../icons';
import { diaperLook } from '../logTypes';
import type { DIAPER_COLORS, LogEntry } from '@subby/shared';
import { useLogStore } from '../../store/useLogStore';
import { useSheetStore } from '../../store/useSheetStore';
import { useFormatTime, useNow } from '../../store/timeHelpers';
import { COLOR_SWATCH } from '../editors';
import { Button } from '../ui';
import { colors } from '../../theme/colors';
import { useSingleFlight } from '../useSingleFlight';

type Condition = 'wet' | 'dirty' | 'both';
type DiaperColor = (typeof DIAPER_COLORS)[number];

// Wet is blue, dirty brown; both is neutral and lets its two colored icons say it.
const KINDS: { condition: Condition; label: string; className: string; Icon: (p: IconProps) => React.ReactNode }[] = [
  { condition: 'wet', label: 'Wet', className: 'bg-blue/20 border-blue/40', Icon: diaperLook('wet').Icon },
  { condition: 'dirty', label: 'Dirty', className: 'bg-brown/30 border-brown-strong/50', Icon: diaperLook('dirty').Icon },
  {
    condition: 'both',
    label: 'Both',
    className: 'bg-raised border-line-strong',
    Icon: diaperLook('both').Icon,
  },
];
// Most common first.
const COLOR_ORDER: DiaperColor[] = ['yellow', 'brown', 'green', 'orange', 'black', 'red', 'white', 'gray'];
const AUTO_CLOSE_MS = 5000;

/** One tap logs a diaper now; then an optional color, Undo, and it closes by itself. */
export default function DiaperSheet({ onClose }: { onClose: () => void }) {
  const addLog = useLogStore((s) => s.addLog);
  const updateLog = useLogStore((s) => s.updateLog);
  const softDeleteLog = useLogStore((s) => s.softDeleteLog);
  const open = useSheetStore((s) => s.open);
  const formatTime = useFormatTime();
  const now = useNow(30_000);
  const [logged, setLogged] = useState<LogEntry | null>(null);

  // Restarted by every change, so picking a color keeps the sheet open a little longer.
  useEffect(() => {
    if (!logged) return;
    const t = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [logged, onClose]);

  const once = useSingleFlight();
  const log = once(async (condition: Condition) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLogged(await addLog({ type: 'diaper', condition }));
  });

  if (!logged || logged.payload.type !== 'diaper') {
    return (
      <View className="pt-1 pb-2">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-ink-muted text-sm">Now, {formatTime(now)}</Text>
          <Pressable hitSlop={10} onPress={() => open({ kind: 'log', type: 'diaper' })}>
            <Text className="text-violet-soft text-sm">Earlier or details…</Text>
          </Pressable>
        </View>
        <View className="flex-row gap-2.5">
          {KINDS.map((k) => (
            <Pressable
              key={k.condition}
              onPress={() => log(k.condition)}
              className={`flex-1 h-24 rounded-2xl border items-center justify-center ${k.className}`}
            >
              <k.Icon size={28} />
              <Text className="text-ink text-base font-semibold mt-2">{k.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text className="text-ink-muted text-xs text-center mt-3">One tap logs it. Add a color after if you like.</Text>
      </View>
    );
  }

  const p = logged.payload;
  const label = KINDS.find((k) => k.condition === p.condition)?.label ?? 'Diaper';
  const setColor = async (color: DiaperColor) => {
    Haptics.selectionAsync();
    const payload = { ...p, color: p.color === color ? undefined : color };
    await updateLog(logged.id, { payload });
    setLogged({ ...logged, payload });
  };

  return (
    <View className="pt-1 pb-2">
      <View className="flex-row items-center">
        <View className="w-10 h-10 rounded-full bg-green/15 border border-green/40 items-center justify-center">
          <Check color={colors.greenSoft} size={20} />
        </View>
        <View className="flex-1 ml-3">
          <Text className="text-ink text-base font-semibold">{label} logged</Text>
          <Text className="text-ink-muted text-xs">
            {formatTime(logged.startedAt)} · {p.color ? p.color.charAt(0).toUpperCase() + p.color.slice(1) : 'no color'}
          </Text>
        </View>
        <Pressable
          onPress={async () => {
            await softDeleteLog(logged.id);
            onClose();
          }}
          className="h-9 px-4 rounded-full border border-line-strong bg-raised items-center justify-center"
        >
          <Text className="text-ink text-sm">Undo</Text>
        </Pressable>
      </View>

      {p.condition === 'dirty' || p.condition === 'both' ? (
        <>
          <Text className="text-ink-muted text-xs font-medium mt-5 mb-2">Color (optional)</Text>
          <View className="flex-row flex-wrap gap-2">
            {COLOR_ORDER.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={{ width: '23%' }}
                className={`h-14 rounded-xl items-center justify-center bg-raised border-2 ${p.color === c ? 'border-violet-strong' : 'border-transparent'}`}
              >
                <View style={{ backgroundColor: COLOR_SWATCH[c] }} className="w-5 h-5 rounded-full border border-line-heavy" />
                <Text className="text-ink-soft text-[11px] mt-1 capitalize">{c}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <Button label="Done" onPress={onClose} />
      <Text className="text-ink-faint text-xs text-center mt-2">Closes by itself after a few seconds</Text>
    </View>
  );
}
