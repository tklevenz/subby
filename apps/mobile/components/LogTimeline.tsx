import React, { useMemo } from 'react';
import { View, Text, SectionList } from 'react-native';
import type { LogEntry } from '@kindred-log/shared';
import { startOfDay } from '@kindred-log/shared';
import { useLogStore } from '../store/useLogStore';
import { formatDayLabel } from '../store/timeHelpers';
import LogRow from './LogRow';

function EmptyState() {
  return (
    <View className="flex-1 justify-center items-center px-8 py-16">
      <Text className="text-ink-faint text-center leading-6">
        No logs yet. Use the buttons below to start tracking.
      </Text>
    </View>
  );
}

function groupByDay(logs: LogEntry[]) {
  const sections: { title: string; day: number; data: LogEntry[] }[] = [];
  for (const entry of logs) {
    const day = startOfDay(entry.startedAt);
    const last = sections[sections.length - 1];
    if (last?.day === day) last.data.push(entry);
    else sections.push({ title: formatDayLabel(entry.startedAt), day, data: [entry] });
  }
  return sections;
}

/** Day-grouped log list. `sinceMs` limits it (e.g. the Home tab shows only the last day). */
export default function LogTimeline({
  sinceMs,
  onEndReached,
  bottomPadding = 24,
}: {
  sinceMs?: number;
  onEndReached?: () => void;
  bottomPadding?: number;
}) {
  const logs = useLogStore((s) => s.logs);
  const sections = useMemo(
    () => groupByDay(sinceMs === undefined ? logs : logs.filter((l) => l.startedAt >= sinceMs)),
    [logs, sinceMs],
  );

  if (sections.length === 0) return <EmptyState />;

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <LogRow entry={item} />}
      renderSectionHeader={({ section }) => (
        <Text className="text-xs font-semibold text-ink-muted uppercase px-5 pt-3 pb-1 bg-ground">
          {section.title} · {section.data.length}
        </Text>
      )}
      stickySectionHeadersEnabled
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    />
  );
}
