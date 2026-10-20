import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import type { LogEntry } from '@kindred-log/shared';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFormatTime } from '../store/timeHelpers';
import { logDisplay } from './logDisplay';
import { colors } from '../theme/colors';

/** Timeline row: tap to open the entry (edit or delete it there). */
export default function LogRow({ entry }: { entry: LogEntry }) {
  const units = useSettingsStore((s) => s.units);
  const formatTime = useFormatTime();
  const display = logDisplay(entry, units, formatTime);

  return (
    <View className="px-4 py-1">
      <Pressable
        onPress={() => router.push(`/entry/${entry.id}`)}
        className={`flex-row items-center px-3 py-2.5 rounded-xl border ${display.bg}`}
      >
        <View className="justify-center">{display.icon}</View>
        <View className="flex-1 ml-3">
          <Text className="text-sm font-medium text-ink" numberOfLines={1}>{display.label}</Text>
          {display.detail ? (
            <Text className="text-xs text-ink-muted mt-0.5" numberOfLines={1}>{display.detail}</Text>
          ) : null}
        </View>
        <Text className="text-xs text-ink-faint">{formatTime(entry.startedAt)}</Text>
        <ChevronRight color={colors.inkGhost} size={14} />
      </Pressable>
    </View>
  );
}
