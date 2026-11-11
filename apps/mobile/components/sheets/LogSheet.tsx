import { t } from '@subby/shared/i18n';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { defaultNap, isCompletePayload, endBeforeStart, isEmptySolids, type LogPayload, type LogType, MINUTE_MS } from '@subby/shared';
import { useLogStore } from '../../store/useLogStore';
import { useSleepOverlaps } from '../../features/sleepOverlap';
import { usePayloadForm } from '../../features/usePayloadForm';
import { savedFeedback } from '../savedFeedback';
import DateTimeField from '../DateTimeField';
import { PayloadEditor } from '../editors';
import { CommonFields } from '../editors/CommonFields';
import { EndTimeNote } from '../editors/EndTimeNote';
import { defaultPayload } from '../logTypes';
import { Button, FieldLabel } from '../ui';
import { useSingleFlight } from '../useSingleFlight';

/** Types logged with a start and an end here, or started as a live timer from the chosen start. */
const TIMED: readonly LogType[] = ['sleep', 'pumping', 'activity'];

/** Generic "log new entry" sheet body for any type (rendered inside SheetHost's BottomSheet). */
export default function LogSheet({
  type,
  initial,
  initialStart,
  onClose,
}: {
  type: LogType;
  initial?: Partial<LogPayload>;
  /** Where the start begins (History's + on another day); else now. */
  initialStart?: number;
  onClose: () => void;
}) {
  const addLog = useLogStore((s) => s.addLog);
  const startTimer = useLogStore((s) => s.startTimer);
  const timed = TIMED.includes(type);
  // Past breastfeed: default to having started 15 min ago so its end isn't in the future.
  const pastBreastfeed = type === 'feed' && initial !== undefined && 'method' in initial && initial.method === 'breast';
  const startOffsetMin = pastBreastfeed ? 15 : 0;

  // Timed types start now with no end: "Start timer" runs from the start; logging a past one needs an end.
  const [startedAt, setStart] = useState(() => (initialStart ?? Date.now()) - startOffsetMin * MINUTE_MS);
  const [end, setEnd] = useState<number | null>(null);
  // Nap or night follows the start time (the usual bedtime, else the clock) until the toggle is used.
  const isNapAt = (t: number) => defaultNap(useLogStore.getState().logs, t);
  const [napChosen, setNapChosen] = useState(initial !== undefined && 'nap' in initial);
  const form = usePayloadForm<LogPayload>(() => {
    const p = { ...defaultPayload(type), ...initial } as LogPayload;
    return p.type === 'sleep' && !napChosen ? { ...p, nap: isNapAt(startedAt) } : p;
  });
  const { payload } = form;

  const patch = (p: Partial<LogPayload>) => {
    if ('nap' in p) setNapChosen(true);
    form.patch(p);
  };
  const setStartedAt = (t: number) => {
    setStart(t);
    if (type === 'sleep' && !napChosen) form.patch({ nap: isNapAt(t) } as Partial<LogPayload>);
  };
  const complete = isCompletePayload(payload) && !isEmptySolids(payload);
  const invalidEnd = timed && endBeforeStart(startedAt, end);
  // The same time can't be two sleeps: checked for what Save would log and for a timer from the start.
  const isSleep = type === 'sleep';
  const overlaps = useSleepOverlaps(isSleep, startedAt, end);

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
    savedFeedback(onClose);
  });

  // A timer from the chosen start time (now unless changed), e.g. for a nap that began a few minutes ago.
  const start = once(async () => {
    await startTimer(payload, startedAt);
    savedFeedback(onClose);
  });

  return (
    <>
      <FieldLabel>{t(timed ? 'logSheet.start' : pastBreastfeed ? 'logSheet.started' : 'logSheet.time')}</FieldLabel>
      <DateTimeField value={startedAt} onChange={setStartedAt} maximumDate={new Date()} title={t(timed ? 'logSheet.startTime' : 'logSheet.time')} />

      {timed ? (
        <>
          <FieldLabel>{t('logSheet.end')}</FieldLabel>
          <View className="flex-row items-center gap-3">
            <DateTimeField value={end} onChange={setEnd} maximumDate={new Date()} title={t('logSheet.endTime')} placeholder={t('logSheet.setEnd')} />
            {end !== null ? (
              <Pressable onPress={() => setEnd(null)} className="rounded-full border border-line-strong px-3 py-2" hitSlop={6}>
                <Text className="text-ink-muted text-sm">{t('logSheet.clear')}</Text>
              </Pressable>
            ) : null}
          </View>
          <EndTimeNote startedAt={startedAt} endedAt={end} overlap={overlaps.shown} whenOpen={t('logSheet.needEnd')} />
        </>
      ) : null}

      <PayloadEditor payload={payload} onChange={patch} />
      <CommonFields payload={payload} onChange={patch} />

      <Button label={t('common.save')} onPress={save} disabled={!complete || (timed && (end === null || invalidEnd || overlaps.save !== null))} />
      {timed ? (
        <Button label={t('logSheet.startTimer')} variant="ghost" onPress={start} disabled={!complete || overlaps.timer !== null} />
      ) : null}
    </>
  );
}
