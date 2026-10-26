import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { formatHoursMinutes, isCompletePayload, type LogPayload, type LogType } from '@kindred-log/shared';
import { useLogStore } from '../../store/useLogStore';
import DateTimeField from '../DateTimeField';
import { PayloadEditor } from '../editors';
import { TagsField } from '../editors/fields';
import { defaultPayload } from '../logTypes';
import { Button, FieldLabel, TextField } from '../ui';

/** Types logged with a start and an end here (default length in minutes), and startable as a live timer. */
const DURATION_TYPES: Partial<Record<LogType, number>> = { sleep: 60, pumping: 15, activity: 10 };

/** Common fields shared by the log sheet and the edit screen. */
export function CommonFields({ payload, onChange }: { payload: LogPayload; onChange: (p: Partial<LogPayload>) => void }) {
  return (
    <View>
      {payload.type !== 'note' ? (
        <>
          <FieldLabel>Notes</FieldLabel>
          <TextField
            value={payload.notes ?? ''}
            onChangeText={(notes) => onChange({ notes: notes || undefined })}
            placeholder="Optional"
            multiline
            style={{ minHeight: 56, textAlignVertical: 'top' }}
          />
        </>
      ) : null}
      <FieldLabel>Tags</FieldLabel>
      <TagsField value={payload.tags} onChange={(tags) => onChange({ tags })} />
    </View>
  );
}

/** Generic "log new entry" sheet body for any type (rendered inside SheetHost's BottomSheet). */
export default function LogSheet({
  type,
  initial,
  onClose,
}: {
  type: LogType;
  initial?: Partial<LogPayload>;
  onClose: () => void;
}) {
  const addLog = useLogStore((s) => s.addLog);
  const startTimer = useLogStore((s) => s.startTimer);
  const defaultDuration = DURATION_TYPES[type];
  // Past breastfeed: default to having started 15 min ago so its end isn't in the future.
  const pastBreastfeed = type === 'feed' && initial !== undefined && 'method' in initial && initial.method === 'breast';
  const startOffsetMin = defaultDuration ?? (pastBreastfeed ? 15 : 0);

  const [payload, setPayload] = useState<LogPayload>(() => ({ ...defaultPayload(type), ...initial }) as LogPayload);
  // Timed types default to "just finished": start = now − the usual length, end = now.
  const [startedAt, setStartedAt] = useState(() => Date.now() - startOffsetMin * 60_000);
  // null: still going (saved as a running timer from the start time).
  const [end, setEnd] = useState<number | null>(() => Date.now());

  const patch = (p: Partial<LogPayload>) => setPayload((cur) => ({ ...cur, ...p }) as LogPayload);
  const complete = isCompletePayload(payload);
  const timed = defaultDuration !== undefined;
  const invalidEnd = timed && end !== null && end <= startedAt;

  const endedAt = (() => {
    if (timed) return end;
    if (payload.type === 'feed') {
      return startedAt + ((payload.leftSeconds ?? 0) + (payload.rightSeconds ?? 0)) * 1000;
    }
    return undefined; // addLog's default for the type
  })();

  const save = async () => {
    await addLog(payload, { startedAt, endedAt });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  const start = async () => {
    await startTimer(payload);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  return (
    <>
      <FieldLabel>{timed ? 'Start' : startOffsetMin ? 'Started' : 'Time'}</FieldLabel>
      <DateTimeField value={startedAt} onChange={setStartedAt} maximumDate={new Date()} title={timed ? 'Start time' : 'Time'} />

      {timed ? (
        <>
          <FieldLabel>End</FieldLabel>
          <View className="flex-row items-center gap-3">
            {end !== null ? (
              <DateTimeField value={end} onChange={setEnd} maximumDate={new Date()} title="End time" />
            ) : (
              <Text className="text-violet-soft text-base py-3">Still going</Text>
            )}
            <Pressable
              onPress={() => setEnd(end === null ? Date.now() : null)}
              className="rounded-full border border-line-strong px-3 py-2"
              hitSlop={6}
            >
              <Text className="text-ink-muted text-sm">{end === null ? 'Set end' : 'Still going'}</Text>
            </Pressable>
          </View>
          {invalidEnd ? (
            <Text className="text-red-strong mt-2">End must be after start.</Text>
          ) : (
            <Text className="text-ink-muted text-sm mt-2">
              {end === null ? 'Saved as running, like a timer started then.' : formatHoursMinutes(end - startedAt)}
            </Text>
          )}
        </>
      ) : null}

      <PayloadEditor payload={payload} onChange={patch} />
      <CommonFields payload={payload} onChange={patch} />

      <Button label="Save" onPress={save} disabled={!complete || invalidEnd} />
      {timed ? (
        <Button label="Start timer now" variant="ghost" onPress={start} disabled={!complete} />
      ) : null}
    </>
  );
}
