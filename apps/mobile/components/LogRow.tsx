import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, Alert, Animated, PanResponder } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, Trash2 } from 'lucide-react-native';
import type { LogEntry } from '@kindred-log/shared';
import { useLogStore } from '../store/useLogStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFormatTime } from '../store/timeHelpers';
import { logDisplay } from './logDisplay';

const DELETE_WIDTH = 80;

/** Timeline row: tap to edit, swipe left to delete (with confirmation). */
export default function LogRow({ entry }: { entry: LogEntry }) {
  const units = useSettingsStore((s) => s.units);
  const formatTime = useFormatTime();
  const softDeleteLog = useLogStore((s) => s.softDeleteLog);
  const display = logDisplay(entry, units, formatTime);
  const [pan] = useState(() => new Animated.Value(0));

  const resetPane = useCallback(() => {
    Animated.spring(pan, { toValue: 0, useNativeDriver: true }).start();
  }, [pan]);

  const confirmDelete = useCallback(() => {
    Alert.alert('Delete Log', 'Are you sure you want to delete this log entry?', [
      { text: 'Cancel', style: 'cancel', onPress: resetPane },
      { text: 'Delete', style: 'destructive', onPress: () => softDeleteLog(entry.id) },
    ], { onDismiss: resetPane });
  }, [entry.id, resetPane, softDeleteLog]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Only claim clear horizontal swipes so taps and vertical scrolling still work.
        onMoveShouldSetPanResponder: (_evt, gs) =>
          Math.abs(gs.dx) > 10 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
        onPanResponderMove: (_evt, gs) => {
          if (gs.dx < 0) pan.setValue(Math.max(gs.dx, -DELETE_WIDTH));
        },
        onPanResponderRelease: (_evt, gs) => {
          if (gs.dx < -DELETE_WIDTH * 0.6) {
            Animated.timing(pan, { toValue: -DELETE_WIDTH, duration: 100, useNativeDriver: true })
              .start(confirmDelete);
          } else {
            resetPane();
          }
        },
        onPanResponderTerminate: resetPane,
      }),
    [confirmDelete, resetPane, pan],
  );

  return (
    <View className="relative px-4 py-1">
      <View
        style={{ position: 'absolute', right: 16, top: 4, bottom: 4, width: DELETE_WIDTH }}
        className="justify-center items-center bg-red-500/30 rounded-lg"
      >
        <Trash2 color="#f87171" size={18} />
      </View>

      <Animated.View style={{ transform: [{ translateX: pan }] }} {...panResponder.panHandlers}>
        <Pressable
          onPress={() => router.push(`/entry/${entry.id}`)}
          className={`flex-row items-center px-3 py-2.5 rounded-xl border bg-slate-950 ${display.bg}`}
        >
          <View className="justify-center">{display.icon}</View>
          <View className="flex-1 ml-3">
            <Text className="text-sm font-medium text-white" numberOfLines={1}>{display.label}</Text>
            {display.detail ? (
              <Text className="text-xs text-slate-400 mt-0.5" numberOfLines={1}>{display.detail}</Text>
            ) : null}
          </View>
          <Text className="text-xs text-slate-500">{formatTime(entry.startedAt)}</Text>
          <ChevronRight color="#475569" size={14} />
        </Pressable>
      </Animated.View>
    </View>
  );
}
