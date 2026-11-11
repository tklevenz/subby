import { t } from '@subby/shared/i18n';
import React, { useMemo } from 'react';
import { SectionLabel } from '../components/ui';
import { Text, View } from 'react-native';
import { CloudSun, Moon, Sun } from '../components/icons';
import { addDays, formatHoursMinutes, predictNextSleep, startOfDay, suggestedSchedule, type ScheduleItem, MINUTE_MS } from '@subby/shared';
import { useLogQuery } from '../store/queries';
import { useActiveChild } from '../store/useActiveChild';
import { useFormatTime, useNow } from '../store/timeHelpers';
import { colors } from '../theme/colors';
import { ScreenScroll } from '../components/ScreenScroll';

const SLEEP = ['sleep'] as const;

export default function ScheduleScreen() {
  const child = useActiveChild();
  const now = useNow(MINUTE_MS);
  const formatTime = useFormatTime();
  const logs = useLogQuery({ from: addDays(startOfDay(now), -8), types: SLEEP });

  const data = useMemo(() => {
    if (!logs || !child) return null;
    return { next: predictNextSleep(logs, child, now), schedule: suggestedSchedule(logs, child, now) };
  }, [logs, child, now]);

  if (!child || !data) return null;
  const { next, schedule } = data;
  const asleep = logs?.some((l) => l.endedAt === null);
  const { norms } = schedule;
  const wakeRange = `${formatHoursMinutes(norms.wakeMin * MINUTE_MS)}–${formatHoursMinutes(norms.wakeMax * MINUTE_MS)}`;

  return (
    <ScreenScroll>
      <View className="bg-violet/10 border border-violet/40 rounded-2xl p-4">
        <Text className="text-violet-pale text-xs font-medium">
          {t(next?.kind === 'bedtime' ? 'schedule.bedtime' : next?.kind === 'nap' ? 'schedule.nextNap' : 'schedule.nextSleep')}
        </Text>
        {next ? (
          <>
            {/* The likely time, then the window to put down in; the suggested day below shows the nap itself. */}
            {/* Past the likely time it says so, instead of a time that has gone by. */}
            <Text className="text-ink text-2xl font-semibold mt-1">
              {now > next.latest
                ? t('schedule.pastWindow')
                : now >= (next.earliest + next.latest) / 2
                  ? t('schedule.anyTimeNow')
                  : t('schedule.around', { time: formatTime((next.earliest + next.latest) / 2) })}
            </Text>
            <Text className="text-ink-soft text-sm mt-0.5">
              {t('schedule.between', { from: formatTime(next.earliest), to: formatTime(next.latest) })}
            </Text>
            <Text className="text-ink-muted text-xs mt-1">
              {t('schedule.awakeSince', {
                time: formatTime(next.wakeAt),
                basis: next.basis === 'personal' ? t('schedule.basisPersonal', { name: child.name }) : t('schedule.basisAge'),
              })}
            </Text>
          </>
        ) : (
          <Text className="text-ink-soft mt-1">
            {asleep
              ? t('schedule.asleep', { name: child.name })
              : logs?.length
                ? t('schedule.logLatest')
                : t('schedule.logSleep')}
          </Text>
        )}
      </View>

      <SectionLabel>{t('schedule.suggested')}</SectionLabel>
      {schedule.planned ? (
        <View className="bg-surface border border-line rounded-2xl px-4 py-1">
          {schedule.items.map((item, i) => (
            <ItemRow key={i} item={item} now={now} formatTime={formatTime} />
          ))}
        </View>
      ) : (
        // Under 3 months, until nights are logged: no planned day (it would end in a mid-afternoon "bedtime").
        <View className="bg-surface border border-line rounded-2xl p-4">
          <Text className="text-ink-soft leading-5">
            {t('schedule.newborn', { range: wakeRange, name: child.name })}
          </Text>
          <Text className="text-ink-muted text-sm mt-2 leading-5">
            {t('schedule.newbornLater', { name: child.name })}
          </Text>
        </View>
      )}

      <Text className="text-ink-faint text-xs mt-4 leading-5">
        {schedule.planned && norms.bedtime !== null
          ? t('schedule.typicalNaps', { count: norms.naps, range: wakeRange })
          : t('schedule.typical', { range: wakeRange })}{' '}
        {schedule.basis === 'personal'
          ? t('schedule.adjusted', { name: child.name })
          : schedule.planned
            ? t('schedule.personalize')
            : ''}
      </Text>
      <Text className="text-ink-ghost text-xs mt-2 leading-5">
        {t('schedule.disclaimer')}
      </Text>
    </ScreenScroll>
  );
}

/** A nap length to the nearest 5 minutes: "1h", "1h 25m", "45m". */
function roughLength(ms: number) {
  const min = Math.round(ms / 300_000) * 5;
  return formatHoursMinutes(min * MINUTE_MS);
}

function ItemRow({ item, now, formatTime }: { item: ScheduleItem; now: number; formatTime: (ms: number) => string }) {
  const end = item.kind === 'nap' ? item.end : item.at;
  // Predictions that have passed fade; what was logged stays.
  const past = !item.logged && end < now;
  const [icon, label, time] =
    item.kind === 'wake'
      ? [<Sun key="i" color={colors.amberSoft} size={16} />, t('schedule.wakeUp'), formatTime(item.at)]
      : item.kind === 'nap'
        ? [
            <CloudSun key="i" color={colors.violetSoft} size={16} />,
            t('schedule.nap', { n: item.index + 1 }),
            // A predicted nap shows its start (its length goes below); a logged one, its actual times.
            item.running
              ? t('schedule.since', { time: formatTime(item.start) })
              : item.logged
                ? t('schedule.fromTo', { from: formatTime(item.start), to: formatTime(item.end) })
                : formatTime(item.start),
          ]
        : [<Moon key="i" color={colors.violetDeep} size={16} />, t('schedule.bedtime'), formatTime(item.at)];
  return (
    <View className={`flex-row items-center py-3 border-b border-line ${past ? 'opacity-40' : ''}`}>
      {icon}
      <View className="flex-1 ml-3">
        <Text className="text-ink">{label}</Text>
        {item.logged ? (
          <Text className="text-ink-faint text-xs">{t(item.kind === 'nap' && item.running ? 'schedule.nappingNow' : 'schedule.logged')}</Text>
        ) : item.kind === 'nap' ? (
          <Text className="text-ink-faint text-xs">{t('schedule.about', { span: roughLength(item.end - item.start) })}</Text>
        ) : null}
      </View>
      <Text className="text-ink-soft">{time}</Text>
    </View>
  );
}
