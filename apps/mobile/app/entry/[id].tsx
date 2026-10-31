import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import {
  TIMED_LOG_TYPES,
  groupNights,
  isCompletePayload,
  isNap,
  isSleepEntry,
  nightOf,
  pauseFeed,
  type LogEntry,
  type LogPayload,
  type Night,
} from '@kindred-log/shared';
import DateTimeField from '../../components/DateTimeField';
import { PayloadEditor } from '../../components/editors';
import { CommonFields } from '../../components/sheets/LogSheet';
import { TYPE_META, activityLabel } from '../../components/logTypes';
import { Button, FieldLabel } from '../../components/ui';
import { useLogStore } from '../../store/useLogStore';
import { useSleepOverlap } from '../../features/sleepOverlap';
import { SubSpinner } from '../../components/brand/loaders';
import NightForm from '../../components/NightForm';
import { useLogQuery } from '../../store/queries';

const DAY = 86_400_000;

/** Edit/backdate any log entry, including ones older than the loaded window. */
export default function EntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<LogEntry | null | undefined>(undefined);

  useEffect(() => {
    useLogStore.getState().getLog(id).then((e) => setEntry(e ?? null));
  }, [id]);

  if (entry === undefined) return <View className="items-center mt-10"><SubSpinner size={36} /></View>;
  if (!entry) return <Stack.Screen options={{ title: 'Entry not found' }} />;
  // A finished night sleep opens as its whole night (with its wakings); anything else as itself.
  return isSleepEntry(entry) && entry.endedAt !== null && !isNap(entry) ? <NightLoader entry={entry} /> : <EntryForm entry={entry} />;
}

function NightLoader({ entry }: { entry: LogEntry }) {
  const rows = useLogQuery({ from: entry.startedAt - DAY, to: entry.startedAt + DAY, types: ['sleep'] });
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
  const timed = TIMED_LOG_TYPES.includes(entry.logType);
  const running = timed && endedAt === null;
  const invalid = endedAt !== null && endedAt < startedAt;
  const overlap = useSleepOverlap(entry.logType === 'sleep', startedAt, endedAt, entry.id);
  // Save lights up only once something changed (an unset field and a missing one compare equal).
  const changed = startedAt !== entry.startedAt || endedAt !== entry.endedAt || JSON.stringify(payload) !== JSON.stringify(entry.payload);

  const patch = (p: Partial<LogPayload>) => setPayload((cur) => ({ ...cur, ...p }) as LogPayload);

  const save = async () => {
    // Stopping a running breastfeed here: fold the running side's time into its total.
    const stopped = entry.endedAt === null && endedAt !== null && payload.type === 'feed';
    await updateLog(entry.id, { payload: stopped ? pauseFeed(payload, endedAt) : payload, startedAt, endedAt });
    router.back();
  };

  const confirmDelete = () =>
    Alert.alert('Delete Log', 'Are you sure you want to delete this log entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await softDeleteLog(entry.id);
          router.back();
        },
      },
    ]);

  const title = payload.type === 'activity' ? activityLabel(payload.kind) : TYPE_META[payload.type].label;

  return (
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />

      <FieldLabel>{timed ? 'Started' : 'Time'}</FieldLabel>
      <DateTimeField value={startedAt} onChange={setStartedAt} maximumDate={new Date()} title="Start time" />

      {timed ? (
        <>
          <FieldLabel>Ended</FieldLabel>
          {running ? (
            <View className="flex-row items-center gap-3">
              {/* mt-4 matches the Button's own top margin, so both sit on one line. */}
              <Text className="text-violet-soft mt-4">Still running</Text>
              <Button label="Stop now" variant="ghost" onPress={() => setEndedAt(Date.now())} />
            </View>
          ) : (
            <DateTimeField value={endedAt!} onChange={setEndedAt} title="End time" />
          )}
          {invalid ? <Text className="text-red-strong mt-2">End must be after start.</Text> : null}
          {!invalid && overlap ? <Text className="text-red-strong mt-2">{overlap}</Text> : null}
        </>
      ) : null}

      <PayloadEditor payload={payload} onChange={patch} />

      <CommonFields payload={payload} onChange={patch} />

      <Button label="Save" onPress={save} disabled={!changed || invalid || overlap !== null || !isCompletePayload(payload)} />
      <Button label="Delete" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}
