import { t } from '@subby/shared/i18n';
import React, { useEffect, useState } from 'react';
import { ScreenScroll } from '../../components/ScreenScroll';
import { Alert, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { TIMED_LOG_TYPES, formatHoursMinutes, groupNights, isCompletePayload, endBeforeStart, isNap, isSleepEntry, nightOf, pauseFeed, type LogEntry, type LogPayload, type Night, DAY_MS } from '@subby/shared';
import DateTimeField from '../../components/DateTimeField';
import { PayloadEditor } from '../../components/editors';
import { CommonFields } from '../../components/sheets/LogSheet';
import { TYPE_META, activityLabel } from '../../components/logTypes';
import { Button, FieldLabel, ErrorText } from '../../components/ui';
import { useLogStore } from '../../store/useLogStore';
import { useSleepOverlap } from '../../features/sleepOverlap';
import { SubSpinner } from '../../components/brand/loaders';
import NightForm from '../../components/NightForm';
import { useLogQuery } from '../../store/queries';
import { useSingleFlight } from '../../components/useSingleFlight';


/** Edit/backdate any log entry, including ones older than the loaded window. */
export default function EntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<LogEntry | null | undefined>(undefined);

  useEffect(() => {
    void useLogStore.getState().getLog(id).then((e) => setEntry(e ?? null));
  }, [id]);

  if (entry === undefined) return <View className="items-center mt-10"><SubSpinner size={36} /></View>;
  if (!entry) return <Stack.Screen options={{ title: t('entry.notFound') }} />;
  // A finished night sleep opens as its whole night (with its wakings); anything else as itself.
  return isSleepEntry(entry) && entry.endedAt !== null && !isNap(entry) ? <NightLoader key={entry.id} entry={entry} /> : <EntryForm key={entry.id} entry={entry} />;
}

function NightLoader({ entry }: { entry: LogEntry }) {
  const rows = useLogQuery({ from: entry.startedAt - DAY_MS, to: entry.startedAt + DAY_MS, types: ['sleep'] });
  // Found once: saving rewrites the pieces, and the form shouldn't switch nights under itself meanwhile.
  const [night, setNight] = useState<Night | null>();
  useEffect(() => {
    if (rows && night === undefined) setNight(nightOf(groupNights(rows, Date.now()), entry.id) ?? null);
  }, [rows, night, entry.id]);

  if (night === undefined) return <View className="items-center mt-10"><SubSpinner size={36} /></View>;
  // Still running at its end (back asleep after a waking): edit the piece itself.
  return night && night.end !== null ? <NightForm night={night} /> : <EntryForm entry={entry} />;
}

function EntryForm({ entry }: { entry: LogEntry }) {
  const updateLog = useLogStore((s) => s.updateLog);
  const softDeleteLog = useLogStore((s) => s.softDeleteLog);

  const [payload, setPayload] = useState<LogPayload>(entry.payload);
  const [startedAt, setStartedAt] = useState(entry.startedAt);
  const [endedAt, setEndedAt] = useState<number | null>(entry.endedAt);
  // A bottle or solids feed logged as a moment (it ends when it starts): moving its time moves both.
  const instant = entry.endedAt === entry.startedAt && payload.type === 'feed' && payload.method !== 'breast';
  const timed = TIMED_LOG_TYPES.includes(entry.logType) && !instant;
  const running = timed && endedAt === null;
  const invalid = endBeforeStart(startedAt, endedAt);
  const overlap = useSleepOverlap(entry.logType === 'sleep', startedAt, endedAt, entry.id);
  // Save lights up only once something changed (an unset field and a missing one compare equal).
  const changed = startedAt !== entry.startedAt || endedAt !== entry.endedAt || JSON.stringify(payload) !== JSON.stringify(entry.payload);

  const patch = (p: Partial<LogPayload>) => setPayload((cur) => ({ ...cur, ...p }) as LogPayload);

  const once = useSingleFlight();
  const save = once(async () => {
    // Stopping a running breastfeed here: fold the running side's time into its total.
    const stopped = entry.endedAt === null && endedAt !== null && payload.type === 'feed';
    await updateLog(entry.id, { payload: stopped ? pauseFeed(payload, endedAt) : payload, startedAt, endedAt });
    router.back();
  });

  const confirmDelete = () =>
    Alert.alert(t('entry.deleteTitle'), t('entry.deleteText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await softDeleteLog(entry.id);
          router.back();
        },
      },
    ]);

  const title = payload.type === 'activity' ? activityLabel(payload.kind) : TYPE_META[payload.type].label;

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />

      <FieldLabel>{t(timed ? 'entry.started' : 'logSheet.time')}</FieldLabel>
      <DateTimeField
        value={startedAt}
        onChange={(t) => {
          setStartedAt(t);
          if (instant) setEndedAt(t);
        }}
        maximumDate={new Date()}
        title={t('logSheet.startTime')}
      />

      {timed ? (
        <>
          <FieldLabel>{t('entry.ended')}</FieldLabel>
          {running ? (
            <View className="flex-row items-center gap-3">
              {/* mt-4 matches the Button's own top margin, so both sit on one line. */}
              <Text className="text-violet-soft mt-4">{t('entry.stillRunning')}</Text>
              <Button label={t('entry.stopNow')} variant="ghost" onPress={() => setEndedAt(Date.now())} />
            </View>
          ) : (
            <DateTimeField value={endedAt!} onChange={setEndedAt} maximumDate={new Date()} title={t('logSheet.endTime')} />
          )}
          {invalid ? <ErrorText className="mt-2">{t('logSheet.endBeforeStart')}</ErrorText> : null}
          {!invalid && overlap ? <ErrorText className="mt-2">{overlap}</ErrorText> : null}
          {!invalid && !overlap && !running && endedAt !== null ? (
            <Text className="text-ink-muted text-sm mt-2">{formatHoursMinutes(endedAt - startedAt)}</Text>
          ) : null}
        </>
      ) : null}

      <PayloadEditor payload={payload} onChange={patch} />

      <CommonFields payload={payload} onChange={patch} />

      <Button label={t('common.save')} onPress={save} disabled={!changed || invalid || overlap !== null || !isCompletePayload(payload)} />
      <Button label={t('common.delete')} variant="dangerQuiet" onPress={confirmDelete} />
    </ScreenScroll>
  );
}
