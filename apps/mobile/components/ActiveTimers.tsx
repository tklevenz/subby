import React from 'react';
import { View, Text, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Stop } from './icons';
import { activeTimers, formatDuration } from '@kindred-log/shared';
import { useLogStore } from '../store/useLogStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFormatTime, useNow } from '../store/timeHelpers';
import { logDisplay } from './logDisplay';
import { colors } from '../theme/colors';

/** Running pumping and activity timers; sleep and feeds show in their own Home tiles. */
export default function ActiveTimers() {
  const logs = useLogStore((s) => s.logs);
  const stopTimer = useLogStore((s) => s.stopTimer);
  const units = useSettingsStore((s) => s.units);
  const formatTime = useFormatTime();
  const now = useNow();
  const timers = activeTimers(logs).filter((l) => l.logType !== 'sleep' && l.logType !== 'feed');

  if (timers.length === 0) return null;

  return (
    <View className="mx-4 mt-2 gap-2">
      {timers.map((t) => {
        const d = logDisplay(t, units, formatTime);
        return (
          <Pressable
            key={t.id}
            onPress={() => router.push(`/entry/${t.id}`)}
            className={`flex-row items-center rounded-xl border px-3 py-2.5 ${d.bg}`}
          >
            {d.icon}
            <Text className="text-ink font-medium ml-2 flex-1">{d.label}</Text>
            <Text className="text-ink font-semibold mr-3">{formatDuration(now - t.startedAt)}</Text>
            <Pressable
              hitSlop={10}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                await stopTimer(t.id);
                // Pumped amount is only known at the end: go straight to the editor.
                if (t.payload.type === 'pumping') router.push(`/entry/${t.id}`);
              }}
              className="bg-raised rounded-full p-2"
            >
              <Stop color={colors.ink} size={14} />
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}
