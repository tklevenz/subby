import React from 'react';
import { View, Text, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Square } from 'lucide-react-native';
import { activeTimers, formatDuration } from '@kindred-log/shared';
import { useLogStore } from '../store/useLogStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSheetStore } from '../store/useSheetStore';
import { useFormatTime, useNow } from '../store/timeHelpers';
import { logDisplay } from './logDisplay';

/** Running non-sleep timers (feeds, pumping, activities); sleep has its own card and dock button. */
export default function ActiveTimers() {
  const logs = useLogStore((s) => s.logs);
  const stopTimer = useLogStore((s) => s.stopTimer);
  const openSheet = useSheetStore((s) => s.open);
  const units = useSettingsStore((s) => s.units);
  const formatTime = useFormatTime();
  const now = useNow();
  const timers = activeTimers(logs).filter((l) => l.logType !== 'sleep');

  if (timers.length === 0) return null;

  return (
    <View className="mx-4 mt-2 gap-2">
      {timers.map((t) => {
        const d = logDisplay(t, units, formatTime);
        return (
          <Pressable
            key={t.id}
            // A running breastfeed opens the side-switching controls; other timers open the editor.
            onPress={() =>
              t.payload.type === 'feed' ? openSheet({ kind: 'feed', tab: 'breast' }) : router.push(`/entry/${t.id}`)
            }
            className={`flex-row items-center rounded-xl border px-3 py-2.5 ${d.bg}`}
          >
            {d.icon}
            <Text className="text-white font-medium ml-2 flex-1">{d.label}</Text>
            <Text className="text-white font-semibold mr-3">{formatDuration(now - t.startedAt)}</Text>
            <Pressable
              hitSlop={10}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                await stopTimer(t.id);
                // Pumped amount is only known at the end: go straight to the editor.
                if (t.payload.type === 'pumping') router.push(`/entry/${t.id}`);
              }}
              className="bg-slate-800 rounded-full p-2"
            >
              <Square color="#f8fafc" size={14} fill="#f8fafc" />
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}
