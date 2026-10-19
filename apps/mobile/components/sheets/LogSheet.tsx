import React, { useState } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { isCompletePayload, type LogPayload, type LogType } from '@kindred-log/shared';
import { useLogStore } from '../../store/useLogStore';
import DateTimeField from '../DateTimeField';
import { PayloadEditor } from '../editors';
import { NumberField, TagsField } from '../editors/fields';
import { defaultPayload } from '../logTypes';
import { Button, FieldLabel, TextField } from '../ui';

/** Types logged with a start + duration here, and startable as a live timer. */
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
  const [durationMin, setDurationMin] = useState<number | undefined>(defaultDuration);
  // Duration types default to "just finished": start = now − duration.
  const [startedAt, setStartedAt] = useState(() => Date.now() - startOffsetMin * 60_000);

  const patch = (p: Partial<LogPayload>) => setPayload((cur) => ({ ...cur, ...p }) as LogPayload);
  const complete = isCompletePayload(payload);

  const endedAt = (() => {
    if (defaultDuration !== undefined) return startedAt + (durationMin ?? 0) * 60_000;
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
      <FieldLabel>{startOffsetMin ? 'Started' : 'Time'}</FieldLabel>
      <DateTimeField value={startedAt} onChange={setStartedAt} maximumDate={new Date()} />

      {defaultDuration !== undefined ? (
        <>
          <FieldLabel>Duration</FieldLabel>
          <NumberField value={durationMin} onChange={setDurationMin} suffix="min" />
        </>
      ) : null}

      <PayloadEditor payload={payload} onChange={patch} />
      <CommonFields payload={payload} onChange={patch} />

      <Button label="Save" onPress={save} disabled={!complete || (defaultDuration !== undefined && !durationMin)} />
      {defaultDuration !== undefined ? (
        <Button label="Start timer now" variant="ghost" onPress={start} disabled={!complete} />
      ) : null}
    </>
  );
}
