import { formatDate, t } from '@subby/shared/i18n';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TabHeader from '../../components/TabHeader';
import { AngleDown, AngleLeft, AngleRight } from '../../components/icons';
import CalendarSheet from '../../components/datetime/CalendarSheet';
import { addDays, dailyStats, startOfDay } from '@subby/shared';
import { DayLog, DayTotals } from '../../components/history/DayLog';
import { useLogQuery } from '../../store/queries';
import { useSettingsStore } from '../../store/useSettingsStore';
import { formatDayLabel, useNow } from '../../store/timeHelpers';
import { colors } from '../../theme/colors';

/** History: one day as a timeline, with wake windows and the day's totals. */
export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  const now = useNow(60_000);
  const units = useSettingsStore((s) => s.units);
  const today = startOfDay(now);
  const days = useMemo(() => [anchor], [anchor]);
  // A day also reads the two before it: last night's sleep and the sleep before the first wake window.
  const logs = useLogQuery({ from: addDays(anchor, -2), to: addDays(anchor, 1) });
  const stats = useMemo(() => (logs ? dailyStats(logs, days, now) : null), [logs, days, now]);
  const [picking, setPicking] = useState(false);
  // The + logs on the day shown: another day at the current time of day (never later than now).
  const logAt = anchor === today ? undefined : Math.min(atTimeOfDay(anchor, now), now);

  const title = formatDayLabel(anchor, now);
  // Under "Today" or "Yesterday", the date itself.
  const subtitle =
    anchor >= addDays(today, -1)
      ? formatDate(anchor, { weekday: 'long', month: 'short', day: 'numeric' })
      : null;

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <TabHeader className="mb-2" logAt={logAt} />
      {/* The day and its totals stay put; only the timeline scrolls. */}
      <View className="px-4">
        <View className="flex-row items-center justify-between my-2">
          <NavButton icon={<AngleLeft color={colors.inkSoft} size={20} />} onPress={() => setAnchor(addDays(anchor, -1))} />
          <View className="items-center">
            {/* The date opens a month calendar to jump to any day. */}
            <Pressable
              onPress={() => setPicking(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('history.pickDay', { day: title })}
              className="flex-row items-center"
            >
              <Text className="text-ink font-semibold text-base">{title}</Text>
              <AngleDown color={colors.inkFaint} size={12} style={{ marginLeft: 6 }} />
            </Pressable>
            {anchor === today ? (
              subtitle ? <Text className="text-ink-muted text-xs">{subtitle}</Text> : null
            ) : (
              <Pressable onPress={() => setAnchor(today)} hitSlop={8}>
                <Text className="text-violet-soft text-xs font-semibold">{t('history.backToToday')}</Text>
              </Pressable>
            )}
          </View>
          <NavButton
            icon={<AngleRight color={anchor >= today ? colors.lineStrong : colors.inkSoft} size={20} />}
            disabled={anchor >= today}
            onPress={() => setAnchor(Math.min(addDays(anchor, 1), today))}
          />
        </View>

        {logs && stats ? <DayTotals stats={stats[0]!} units={units} /> : null}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32 }}>
        {logs ? <DayLog logs={logs} day={anchor} now={now} /> : null}
      </ScrollView>
      {picking ? (
        <CalendarSheet
          value={anchor}
          onClose={() => setPicking(false)}
          onPick={(day) => {
            setPicking(false);
            setAnchor(day);
          }}
        />
      ) : null}
    </View>
  );
}

/** `day` (a local midnight) at the clock time of `now`. */
function atTimeOfDay(day: number, now: number): number {
  const d = new Date(day);
  const n = new Date(now);
  d.setHours(n.getHours(), n.getMinutes(), 0, 0);
  return d.getTime();
}

function NavButton({ icon, onPress, disabled }: { icon: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10} className="w-9 h-9 rounded-full bg-surface items-center justify-center">
      {icon}
    </Pressable>
  );
}
