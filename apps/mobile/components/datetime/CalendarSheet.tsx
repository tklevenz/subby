import React, { useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { startOfDay } from '@subby/shared';
import { useLogQuery } from '../../store/queries';
import { AngleLeft, AngleRight } from '../icons';
import { colors } from '../../theme/colors';
import { monthGrid } from './parts';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map((d) => new Date(2026, 1, d + 1).toLocaleDateString([], { weekday: 'narrow' }));

/**
 * Pick a day from a month calendar (Monday first). Days with entries get a dot (whether anything was logged,
 * never how much); future days are disabled. Arrows or a sideways swipe change the month.
 */
export default function CalendarSheet({
  value,
  onPick,
  onClose,
}: {
  /** The selected day (any time on it). */
  value: number;
  onPick: (day: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const today = startOfDay(Date.now());
  const [month, setMonth] = useState(() => {
    const d = new Date(value);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const first = new Date(month.year, month.month, 1).getTime();
  const next = new Date(month.year, month.month + 1, 1).getTime();
  const atLatest = next > today;
  const shift = (by: number) =>
    setMonth((m) => {
      const d = new Date(m.year, m.month + by, 1);
      return d.getTime() > today ? m : { year: d.getFullYear(), month: d.getMonth() };
    });

  const weeks = useMemo(() => monthGrid(month.year, month.month), [month]);
  const logs = useLogQuery({ from: first, to: next });
  const logged = useMemo(() => new Set((logs ?? []).map((l) => startOfDay(l.startedAt))), [logs]);
  const selected = startOfDay(value);

  // A sideways swipe over the grid changes the month.
  const shiftRef = useRef(shift);
  shiftRef.current = shift;
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -40) shiftRef.current(1);
        else if (g.dx > 40) shiftRef.current(-1);
      },
    }),
  ).current;

  return (
    <Modal transparent animationType="slide" visible statusBarTranslucent onRequestClose={onClose}>
      {/* The scrim lies behind the sheet too, so its rounded corners show the dimmed screen. */}
      <View className="flex-1 justify-end">
      <Pressable onPress={onClose} className="absolute inset-0 bg-scrim/50" />
      <View className="bg-surface border-t border-line-strong/50 rounded-t-2xl px-4 pt-4" style={{ paddingBottom: insets.bottom + 12 }}>
        <View className="flex-row items-center justify-between">
          <MonthButton label="Previous month" onPress={() => shift(-1)} icon={<AngleLeft color={colors.inkSoft} size={16} />} />
          <Text className="text-ink text-lg font-bold">
            {new Date(first).toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </Text>
          <MonthButton
            label="Next month"
            onPress={() => shift(1)}
            disabled={atLatest}
            icon={<AngleRight color={atLatest ? colors.lineStrong : colors.inkSoft} size={16} />}
          />
        </View>

        <View className="flex-row mt-4">
          {WEEKDAYS.map((d, i) => (
            <Text key={i} className="flex-1 text-center text-ink-faint text-xs font-semibold">
              {d}
            </Text>
          ))}
        </View>

        <View {...swipe.panHandlers} className="mt-1">
          {weeks.map((week, w) => (
            <View key={w} className="flex-row">
              {week.map((day, i) => {
                if (day === null) return <View key={i} className="flex-1 h-12" />;
                const future = day > today;
                const isSelected = day === selected;
                const isToday = day === today;
                return (
                  <Pressable
                    key={i}
                    disabled={future}
                    onPress={() => onPick(day)}
                    accessibilityRole="button"
                    accessibilityLabel={new Date(day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
                    accessibilityState={{ selected: isSelected, disabled: future }}
                    className="flex-1 h-12 items-center justify-center"
                  >
                    <View
                      className={`w-10 h-10 rounded-full items-center justify-center ${
                        isSelected ? 'bg-violet-deep' : isToday ? 'border border-violet-strong' : ''
                      }`}
                    >
                      <Text
                        className={`text-[15px] ${isSelected ? 'text-ink font-bold' : future ? 'text-ink-ghost' : 'text-ink'}`}
                        style={{ fontVariant: ['tabular-nums'] }}
                      >
                        {new Date(day).getDate()}
                      </Text>
                      {/* Something was logged this day. */}
                      {logged.has(day) && !isSelected ? <View className="absolute bottom-1 w-1 h-1 rounded-full bg-violet-soft" /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        <View className="flex-row justify-between mt-2">
          <Pressable onPress={onClose} className="py-3 px-2">
            <Text className="text-ink text-base font-semibold">Cancel</Text>
          </Pressable>
          {selected !== today ? (
            <Pressable onPress={() => onPick(today)} className="py-3 px-2">
              <Text className="text-violet-soft text-base font-semibold">Today</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      </View>
    </Modal>
  );
}

function MonthButton({ label, icon, onPress, disabled }: { label: string; icon: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="w-10 h-10 rounded-full border border-line items-center justify-center"
    >
      {icon}
    </Pressable>
  );
}
