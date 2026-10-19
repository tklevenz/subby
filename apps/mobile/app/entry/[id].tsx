import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { TIMED_LOG_TYPES, isCompletePayload, type LogEntry, type LogPayload } from '@kindred-log/shared';
import DateTimeField from '../../components/DateTimeField';
import { PayloadEditor } from '../../components/editors';
import { CommonFields } from '../../components/sheets/LogSheet';
import { TYPE_META, activityLabel } from '../../components/logTypes';
import { Button, FieldLabel } from '../../components/ui';
import { useLogStore } from '../../store/useLogStore';

/** Edit/backdate any log entry. */
export default function EntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const entry = useLogStore((s) => s.logs.find((l) => l.id === id));
  return entry ? <EntryForm entry={entry} /> : <Stack.Screen options={{ title: 'Entry not found' }} />;
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

  const patch = (p: Partial<LogPayload>) => setPayload((cur) => ({ ...cur, ...p }) as LogPayload);

  const save = async () => {
    await updateLog(entry.id, { payload, startedAt, endedAt });
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
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />

      <FieldLabel>{timed ? 'Started' : 'Time'}</FieldLabel>
      <DateTimeField value={startedAt} onChange={setStartedAt} maximumDate={new Date()} />

      {timed ? (
        <>
          <FieldLabel>Ended</FieldLabel>
          {running ? (
            <View className="flex-row items-center gap-3">
              <Text className="text-violet-300">Still running</Text>
              <Button label="Stop now" variant="ghost" onPress={() => setEndedAt(Date.now())} />
            </View>
          ) : (
            <DateTimeField value={endedAt!} onChange={setEndedAt} />
          )}
          {invalid ? <Text className="text-red-400 mt-2">End must be after start.</Text> : null}
        </>
      ) : null}

      <PayloadEditor payload={payload} onChange={patch} />

      <CommonFields payload={payload} onChange={patch} />

      <Button label="Save" onPress={save} disabled={invalid || !isCompletePayload(payload)} />
      <Button label="Delete" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}
