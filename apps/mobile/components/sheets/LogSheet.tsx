import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { defaultNap, formatHoursMinutes, isCompletePayload, type LogPayload, type LogType } from '@kindred-log/shared';
import { useLogStore } from '../../store/useLogStore';
import { useSleepOverlap } from '../../features/sleepOverlap';
import DateTimeField from '../DateTimeField';
import { PayloadEditor } from '../editors';
import { TagsField } from '../editors/fields';
import { defaultPayload } from '../logTypes';
import { Button, FieldLabel, TextField } from '../ui';
import { useSingleFlight } from '../useSingleFlight';

/** Types logged with a start and an end here, or started as a live timer from the chosen start. */
const TIMED: readonly LogType[] = ['sleep', 'pumping', 'activity'];

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
  const timed = TIMED.includes(type);
  // Past breastfeed: default to having started 15 min ago so its end isn't in the future.
  const pastBreastfeed = type === 'feed' && initial !== undefined && 'method' in initial && initial.method === 'breast';
  const startOffsetMin = pastBreastfeed ? 15 : 0;

  // Timed types start now with no end: "Start timer" runs from the start; logging a past one needs an end.
  const [startedAt, setStart] = useState(() => Date.now() - startOffsetMin * 60_000);
  const [end, setEnd] = useState<number | null>(null);
  // Nap or night follows the start time (the usual bedtime, else the clock) until the toggle is used.
  const isNapAt = (t: number) => defaultNap(useLogStore.getState().logs, t);
  const [napChosen, setNapChosen] = useState(initial !== undefined && 'nap' in initial);
  const [payload, setPayload] = useState<LogPayload>(() => {
    const p = { ...defaultPayload(type), ...initial } as LogPayload;
    return p.type === 'sleep' && !napChosen ? { ...p, nap: isNapAt(startedAt) } : p;
  });

  const patch = (p: Partial<LogPayload>) => {
    if ('nap' in p) setNapChosen(true);
    setPayload((cur) => ({ ...cur, ...p }) as LogPayload);
  };
  const setStartedAt = (t: number) => {
    setStart(t);
    if (type === 'sleep' && !napChosen) setPayload((cur) => ({ ...cur, nap: isNapAt(t) }) as LogPayload);
  };
  const complete = isCompletePayload(payload);
  const invalidEnd = timed && end !== null && end <= startedAt;
  // The same time can't be two sleeps: checked for what Save would log and for a timer from the start.
  const isSleep = type === 'sleep';
  const saveOverlap = useSleepOverlap(isSleep && end !== null, startedAt, end);
  const timerOverlap = useSleepOverlap(isSleep, startedAt, null);

  const endedAt = (() => {
    if (timed) return end;
    if (payload.type === 'feed') {
      return startedAt + ((payload.leftSeconds ?? 0) + (payload.rightSeconds ?? 0)) * 1000;
    }
    return undefined; // addLog's default for the type
  })();

  const once = useSingleFlight();
  const save = once(async () => {
    await addLog(payload, { startedAt, endedAt });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  });

  // A timer from the chosen start time (now unless changed), e.g. for a nap that began a few minutes ago.
  const start = once(async () => {
    await startTimer(payload, startedAt);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  });

  return (
    <>
      <FieldLabel>{timed ? 'Start' : pastBreastfeed ? 'Started' : 'Time'}</FieldLabel>
      <DateTimeField value={startedAt} onChange={setStartedAt} maximumDate={new Date()} title={timed ? 'Start time' : 'Time'} />

      {timed ? (
        <>
          <FieldLabel>End</FieldLabel>
          <View className="flex-row items-center gap-3">
            <DateTimeField value={end} onChange={setEnd} maximumDate={new Date()} title="End time" placeholder="Set end time" />
            {end !== null ? (
              <Pressable onPress={() => setEnd(null)} className="rounded-full border border-line-strong px-3 py-2" hitSlop={6}>
                <Text className="text-ink-muted text-sm">Clear</Text>
              </Pressable>
            ) : null}
          </View>
          {invalidEnd ? (
            <Text className="text-red-strong mt-2">End must be after start.</Text>
          ) : (end !== null ? saveOverlap : timerOverlap) ? (
            <Text className="text-red-strong mt-2">{end !== null ? saveOverlap : timerOverlap}</Text>
          ) : (
            <Text className="text-ink-muted text-sm mt-2">
              {end === null ? 'Set an end time to log a past one, or start a timer.' : formatHoursMinutes(end - startedAt)}
            </Text>
          )}
        </>
      ) : null}

      <PayloadEditor payload={payload} onChange={patch} />
      <CommonFields payload={payload} onChange={patch} />

      <Button label="Save" onPress={save} disabled={!complete || (timed && (end === null || invalidEnd || saveOverlap !== null))} />
      {timed ? (
        <Button label="Start timer" variant="ghost" onPress={start} disabled={!complete || timerOverlap !== null} />
      ) : null}
    </>
  );
}
