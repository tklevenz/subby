import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  Animated,
  PanResponder,
} from 'react-native';
import { useLogStore } from '../store/useLogStore';
import { formatTimeShort } from '../store/timeHelpers';
import { LogEntry, LogPayload } from '@kindred/shared';
import {
  Droplets,
  Baby,
  Moon,
  Trash2,
  ChevronRight,
} from 'lucide-react-native';

type PayloadDisplay = {
  icon: React.ReactNode;
  bg: string;
  label: string;
  detail: string;
};

function payloadDisplay(p: LogPayload, startedAt: number): PayloadDisplay {
  switch (p.type) {
    case 'diaper':
      return {
        icon: <Droplets color="#fbbf24" size={18} />,
        bg: 'border-amber-500/40 bg-amber-500/10',
        label: p.condition === 'both' ? 'Diaper (Wet + Dirty)' : `Diaper (${p.condition})`,
        detail: '',
      };
    case 'feed':
      return {
        icon: <Baby color="#67e8f9" size={18} />,
        bg: 'border-cyan-500/40 bg-cyan-500/10',
        label:
          p.method === 'bottle'
            ? `Bottle — ${p.amountMl ?? '—'}ml`
            : p.method === 'solids'
              ? 'Solids'
              : `Breast — ${p.method.replace('breast_', '')}`,
        detail: '',
      };
    case 'sleep':
      return {
        icon: <Moon color="#a78bfa" size={18} />,
        bg: 'border-violet-500/40 bg-violet-500/10',
        label: p.endedAt === null ? 'Sleeping…' : 'Nap',
        detail: p.endedAt !== null
          ? `(${formatTimeShort(startedAt)} → ${formatTimeShort(p.endedAt)})`
          : '(ongoing)',
      };
    default:
      return {
        icon: <Droplets color="#94a3b8" size={18} />,
        bg: 'border-slate-500/40 bg-slate-500/10',
        label: 'Unknown',
        detail: '',
      };
  }
}

function LogRow({
  entry,
  onSwipeDelete,
}: {
  entry: LogEntry;
  onSwipeDelete: (id: string) => void;
}) {
  const display = payloadDisplay(entry.payload, entry.startedAt);
  const [pan] = useState(() => new Animated.Value(0));
  const deleteWidth = 80;

  const resetPane = useCallback(() => {
    Animated.spring(pan, { toValue: 0, useNativeDriver: true }).start();
  }, [pan]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_evt, gs) => {
          if (gs.dx < 0) pan.setValue(gs.dx > -deleteWidth ? gs.dx : -deleteWidth);
        },
        onPanResponderRelease: (_evt, gs) => {
          if (gs.dx < -deleteWidth * 0.6) {
            Animated.timing(pan, {
              toValue: -deleteWidth,
              duration: 100,
              useNativeDriver: true,
            }).start(() => onSwipeDelete(entry.id));
          } else {
            resetPane();
          }
        },
      }),
    [entry.id, onSwipeDelete, resetPane, pan],
  );

  return (
    <View className="relative px-4 py-1">
      {/* Delete button (slides in from right) */}
      <Animated.View
        style={{
          position: 'absolute',
          right: 16,
          top: 6,
          bottom: 6,
          width: deleteWidth,
        }}
      >
        <View className="justify-center items-center bg-red-500/30 rounded-lg" style={{ height: '100%' }}>
          <Trash2 color="#f87171" size={18} />
        </View>
      </Animated.View>

      {/* Swipeable content */}
      <Animated.View
        style={{ transform: [{ translateX: pan }] }}
        {...panResponder.panHandlers}
      >
        <View
          className={`flex-row items-center px-3 py-2.5 rounded-xl border ${display.bg}`}
        >
          <View className="justify-center">{display.icon}</View>
          <View className="flex-1 ml-3">
            <Text className="text-sm font-medium text-white">{display.label}</Text>
            {display.detail ? (
              <Text className="text-xs text-slate-400 mt-0.5">{display.detail}</Text>
            ) : null}
          </View>
          <Text className="text-xs text-slate-500">{formatTimeShort(entry.startedAt)}</Text>
          <ChevronRight color="#475569" size={14} />
        </View>
      </Animated.View>
    </View>
  );
}

function EmptyState() {
  return (
    <View className="flex-1 justify-center items-center px-8">
      <Text className="text-slate-500 text-center leading-6">
        No logs yet. Use the buttons below to start tracking.
      </Text>
    </View>
  );
}

export default function LogTimeline() {
  const logs = useLogStore((s) => s.logs);
  const softDeleteLog = useLogStore((s) => s.softDeleteLog);

  const handleSwipeDelete = useCallback(
    (id: string) => {
      Alert.alert(
        'Delete Log',
        'Are you sure you want to delete this log entry?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => softDeleteLog(id),
          },
        ],
      );
    },
    [softDeleteLog],
  );

  if (logs.length === 0) return <EmptyState />;

  return (
    <FlatList
      data={logs}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <LogRow entry={item} onSwipeDelete={handleSwipeDelete} />
      )}
      contentContainerStyle={{ paddingBottom: 200 }}
      showsVerticalScrollIndicator={false}
    />
  );
}
