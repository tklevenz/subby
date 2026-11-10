import React, { useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDayLabel, useFormatTime } from '../store/timeHelpers';
import { useSettingsStore } from '../store/useSettingsStore';
import WheelColumn, { ITEM_HEIGHT, VISIBLE_ROWS } from './datetime/WheelColumn';
import { dayOptions, daysInMonth, from12, joinTime, splitTime, to12 } from './datetime/parts';

const pad = (n: number) => String(n).padStart(2, '0');
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const MONTHS = range(0, 11).map((m) => new Date(2000, m, 1).toLocaleDateString([], { month: 'short' }));

/**
 * A date + time field for epoch ms. Tapping it opens a sheet of wheels: day ("Today", "Sun 25 Oct"…), hour and
 * minute (plus AM/PM on a 12-hour clock); in `date` mode day, month and year. The same on iOS and Android.
 */
export default function DateTimeField({
  value,
  onChange,
  mode = 'datetime',
  maximumDate,
  title,
  placeholder,
  timeOnly,
}: {
  /** null: not set yet; the field shows `placeholder` and the wheels open at now. */
  value: number | null;
  onChange: (ms: number) => void;
  mode?: 'datetime' | 'date';
  maximumDate?: Date;
  /** Sheet heading, e.g. "Start time". */
  title?: string;
  placeholder?: string;
  /** Show only the time (where the day is clear from around it, e.g. a night's wakings). */
  timeOnly?: boolean;
}) {
  const formatTime = useFormatTime();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} className="bg-raised border border-line-strong rounded-xl px-4 py-3 self-start">
        {value === null ? (
          <Text className="text-ink-muted text-base">{placeholder ?? 'Set time'}</Text>
        ) : (
          <Text className="text-ink text-base">
            {mode === 'date'
              ? new Date(value).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
              : timeOnly
                ? formatTime(value)
                : `${formatDayLabel(value)} · ${formatTime(value)}`}
          </Text>
        )}
      </Pressable>
      {open ? (
        <WheelSheet
          title={title ?? (mode === 'date' ? 'Date' : 'Time')}
          value={value ?? Math.min(Date.now(), maximumDate?.getTime() ?? Infinity)}
          mode={mode}
          max={maximumDate?.getTime()}
          onCancel={() => setOpen(false)}
          onSave={(ms) => {
            setOpen(false);
            onChange(ms);
          }}
        />
      ) : null}
    </>
  );
}

function WheelSheet({
  title,
  value,
  mode,
  max,
  onCancel,
  onSave,
}: {
  title: string;
  value: number;
  mode: 'datetime' | 'date';
  max?: number;
  onCancel: () => void;
  onSave: (ms: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(value);
  // Later than allowed (e.g. the future for a start time) saves as the latest allowed moment.
  const save = () => onSave(max !== undefined ? Math.min(draft, max) : draft);

  return (
    <Modal transparent animationType="slide" visible statusBarTranslucent onRequestClose={onCancel}>
      {/* The scrim lies behind the sheet too, so its rounded corners show the dimmed screen. */}
      <View className="flex-1 justify-end">
      <Pressable onPress={onCancel} className="absolute inset-0 bg-scrim/50" />
      <View className="bg-surface border-t border-line-strong/50 rounded-t-2xl px-5 pt-5" style={{ paddingBottom: insets.bottom + 8 }}>
        <Text className="text-ink text-lg font-bold text-center">{title}</Text>
        <View className="mt-4" style={{ height: ITEM_HEIGHT * VISIBLE_ROWS }}>
          {/* The selected row, between two lines. */}
          <View
            pointerEvents="none"
            className="absolute left-0 right-0 border-t border-b border-line-strong"
            style={{ top: ITEM_HEIGHT * Math.floor(VISIBLE_ROWS / 2), height: ITEM_HEIGHT }}
          />
          {mode === 'date' ? <DateWheels value={draft} onChange={setDraft} /> : <DateTimeWheels value={draft} max={max} onChange={setDraft} />}
        </View>
        <View className="flex-row mt-4">
          <Pressable onPress={onCancel} className="flex-1 items-center py-4">
            <Text className="text-ink text-base font-semibold">Cancel</Text>
          </Pressable>
          <Pressable onPress={save} className="flex-1 items-center py-4">
            <Text className="text-violet-soft text-base font-semibold">Save</Text>
          </Pressable>
        </View>
      </View>
      </View>
    </Modal>
  );
}

function DateTimeWheels({ value, max, onChange }: { value: number; max?: number; onChange: (ms: number) => void }) {
  const clock = useSettingsStore((s) => s.clock);
  // The day list is fixed while the sheet is open (built from the value it opened with).
  const [days] = useState(() => dayOptions(value, Date.now(), max));
  const dayLabels = useMemo(() => days.map((d) => formatDayLabel(d)), [days]);
  const { day, hour, minute } = splitTime(value);
  const dayIndex = Math.max(0, days.indexOf(day));
  const set = (patch: Partial<{ day: number; hour: number; minute: number }>) => {
    const next = { day, hour, minute, ...patch };
    onChange(joinTime(next.day, next.hour, next.minute));
  };

  const minutes = range(0, 59).map(pad);
  if (clock === '12h') {
    const { hour12, pm } = to12(hour);
    return (
      <View className="flex-row">
        <WheelColumn labels={dayLabels} index={dayIndex} onChange={(i) => set({ day: days[i]! })} />
        <WheelColumn labels={range(1, 12).map(String)} index={hour12 - 1} onChange={(i) => set({ hour: from12(i + 1, pm) })} width={56} />
        <WheelColumn labels={minutes} index={minute} onChange={(i) => set({ minute: i })} width={56} />
        <WheelColumn labels={['AM', 'PM']} index={pm ? 1 : 0} onChange={(i) => set({ hour: from12(hour12, i === 1) })} width={56} />
      </View>
    );
  }
  return (
    <View className="flex-row">
      <WheelColumn labels={dayLabels} index={dayIndex} onChange={(i) => set({ day: days[i]! })} />
      <WheelColumn labels={range(0, 23).map(pad)} index={hour} onChange={(i) => set({ hour: i })} width={64} />
      <WheelColumn labels={minutes} index={minute} onChange={(i) => set({ minute: i })} width={64} />
    </View>
  );
}

/** Day, month, year (a birth date): no time; the day is clamped to the month's length. */
function DateWheels({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  const d = new Date(value);
  const thisYear = new Date().getFullYear();
  const [years] = useState(() => range(Math.min(d.getFullYear(), thisYear - 20), thisYear));
  const set = (patch: Partial<{ day: number; month: number; year: number }>) => {
    const next = { day: d.getDate(), month: d.getMonth(), year: d.getFullYear(), ...patch };
    const day = Math.min(next.day, daysInMonth(next.year, next.month));
    onChange(new Date(next.year, next.month, day, 12).getTime());
  };
  return (
    <View className="flex-row">
      <WheelColumn labels={range(1, 31).map(String)} index={d.getDate() - 1} onChange={(i) => set({ day: i + 1 })} width={64} />
      <WheelColumn labels={MONTHS} index={d.getMonth()} onChange={(i) => set({ month: i })} />
      <WheelColumn labels={years.map(String)} index={Math.max(0, years.indexOf(d.getFullYear()))} onChange={(i) => set({ year: years[i]! })} width={84} />
    </View>
  );
}
