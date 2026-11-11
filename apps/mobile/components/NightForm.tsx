import { t } from '@subby/shared/i18n';
import React, { useState } from 'react';
import { ScreenScroll } from './ScreenScroll';
import { Alert, Pressable, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { formatHoursMinutes, nightPieces, type LogPayload, type Night, type PayloadOf, type Waking, MINUTE_MS } from '@subby/shared';
import DateTimeField from './DateTimeField';
import { PayloadEditor } from './editors';
import { CommonFields } from './sheets/LogSheet';
import { Button, FieldLabel, ErrorText } from './ui';
import NightBar from './NightBar';
import { Moon, Plus, Xmark } from './icons';
import { useLogStore, type LogPatch } from '../store/useLogStore';
import { useSleepOverlap } from '../features/sleepOverlap';
import { useFormatTime } from '../store/timeHelpers';
import { colors } from '../theme/colors';
import { useSingleFlight } from './useSingleFlight';

/** A new waking: this long, in the middle of the night's longest stretch. */
const NEW_WAKING_MS = 15 * MINUTE_MS;

/**
 * A finished night as one: bedtime, wake-up and the wakings between. Saving turns it back into sleep pieces,
 * reusing the existing entries in order, adding new ones for added wakings and deleting the ones a removed waking
 * joined (their notes move to the first). Opened from any piece of the night.
 */
export default function NightForm({ night }: { night: Night }) {
  const writeLogs = useLogStore((s) => s.writeLogs);
  const deleteLogs = useLogStore((s) => s.deleteLogs);
  const formatTime = useFormatTime();

  const first = night.pieces[0]!;
  const [bedtime, setBedtime] = useState(night.start);
  const [wakeUp, setWakeUp] = useState(night.end!);
  // Pieces that touch (edited to meet) make a waking of no length: left out, so saving joins them.
  const [initialWakings] = useState(() => night.wakings.filter((w) => w.end > w.start));
  const [wakings, setWakings] = useState<Waking[]>(initialWakings);
  const [payload, setPayload] = useState<PayloadOf<'sleep'>>(first.payload);
  // The editors are shared by every type; this one only ever gets a sleep's fields.
  const patch = (p: Partial<LogPayload>) => setPayload((cur) => ({ ...cur, ...(p as Partial<PayloadOf<'sleep'>>) }));

  const pieces = nightPieces(bedtime, wakeUp, wakings);
  const ids = night.pieces.map((p) => p.id);
  const overlap = useSleepOverlap(true, bedtime, wakeUp, ids);
  const nap = payload.nap !== false;
  const error =
    wakeUp <= bedtime
      ? t('night.wakeAfterBed')
      : !pieces
        ? t('night.wakingInside')
        : nap && wakings.length
          ? t('night.napNoWakings')
          : overlap;
  const changed =
    bedtime !== night.start ||
    wakeUp !== night.end ||
    JSON.stringify(wakings) !== JSON.stringify(initialWakings) ||
    JSON.stringify(payload) !== JSON.stringify(first.payload);

  const setWaking = (i: number, w: Partial<Waking>) => setWakings((cur) => cur.map((x, j) => (j === i ? { ...x, ...w } : x)));
  const addWaking = () => {
    const stretches = pieces ?? [{ start: bedtime, end: wakeUp }];
    const longest = stretches.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    if (longest.end - longest.start < NEW_WAKING_MS + 2 * MINUTE_MS) return;
    const mid = Math.round((longest.start + longest.end - NEW_WAKING_MS) / 2 / (5 * MINUTE_MS)) * 5 * MINUTE_MS;
    setWakings((cur) => [...cur, { start: mid, end: mid + NEW_WAKING_MS }].sort((a, b) => a.start - b.start));
  };

  const once = useSingleFlight();
  const save = once(async () => {
    if (!pieces) return;
    const joined = night.pieces.slice(pieces.length);
    const notes = [payload.notes, ...joined.map((p) => p.payload.notes)].filter(Boolean).join('\n') || undefined;
    const firstPayload = { ...payload, notes };
    // One transaction: a failure leaves the night as it was, and screens re-read once.
    const update: { id: string; patch: LogPatch }[] = [];
    const add: { payload: LogPayload; startedAt: number; endedAt: number }[] = [];
    for (const [i, { start, end }] of pieces.entries()) {
      const existing = night.pieces[i];
      if (!existing) add.push({ payload: { type: 'sleep', nap: false }, startedAt: start, endedAt: end });
      else if (i === 0) update.push({ id: existing.id, patch: { payload: firstPayload, startedAt: start, endedAt: end } });
      else if (existing.startedAt !== start || existing.endedAt !== end) update.push({ id: existing.id, patch: { startedAt: start, endedAt: end } });
    }
    await writeLogs({ add, update, remove: joined.map((p) => p.id) });
    router.back();
  });

  const confirmDelete = () =>
    Alert.alert(t('night.deleteTitle'), night.pieces.length > 1 ? t('night.deleteWhole') : t('night.deleteSleep'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteLogs(night.pieces.map((p) => p.id));
          router.back();
        },
      },
    ]);

  const asleep = (pieces ?? []).reduce((a, p) => a + p.end - p.start, 0);
  const longest = Math.max(0, ...(pieces ?? []).map((p) => p.end - p.start));

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t(nap ? 'night.titleSleep' : 'night.titleNight') }} />

      {pieces ? (
        <View className="bg-violet/10 border border-violet/40 rounded-2xl p-4">
          <View className="flex-row items-center">
            <Moon color={colors.violetStrong} size={14} />
            <Text className="text-violet-pale text-[13px] ml-2">{t('night.inBed', { span: formatHoursMinutes(wakeUp - bedtime) })}</Text>
          </View>
          <Text className="text-ink text-[28px] leading-[32px] font-bold mt-1.5">{t('night.asleep', { span: formatHoursMinutes(asleep) })}</Text>
          <View className="mt-2.5">
            <NightBar stretches={pieces} />
          </View>
          <View className="flex-row justify-between mt-1.5">
            <Text className="text-ink-muted text-xs">{formatTime(bedtime)}</Text>
            <Text className="text-ink-muted text-xs">
              {wakings.length ? t('night.wakingsLongest', { count: wakings.length, span: formatHoursMinutes(longest) }) : t('night.noWakings')}
            </Text>
            <Text className="text-ink-muted text-xs">{formatTime(wakeUp)}</Text>
          </View>
        </View>
      ) : null}

      <View className="flex-row gap-3">
        <View className="flex-1">
          <FieldLabel>{t('night.bedtime')}</FieldLabel>
          <DateTimeField value={bedtime} onChange={setBedtime} maximumDate={new Date()} title={t('night.bedtime')} />
        </View>
        <View className="flex-1">
          <FieldLabel>{t('night.wokeUp')}</FieldLabel>
          <DateTimeField value={wakeUp} onChange={setWakeUp} maximumDate={new Date()} title={t('night.wokeUp')} />
        </View>
      </View>

      {!nap ? (
        <>
          <FieldLabel>{t('night.wakings')}</FieldLabel>
          <View className="bg-surface border border-line rounded-2xl">
            {wakings.map((w, i) => (
              <View key={i} className="flex-row items-center gap-2 px-3 py-2.5 border-b border-line">
                <DateTimeField value={w.start} onChange={(start) => setWaking(i, { start })} title={t('night.awakeFrom')} timeOnly />
                <Text className="text-ink-muted">–</Text>
                <DateTimeField value={w.end} onChange={(end) => setWaking(i, { end })} title={t('night.backAsleep')} timeOnly />
                <Text className="flex-1 text-ink-muted text-xs ml-1" numberOfLines={1}>
                  {w.end > w.start ? formatHoursMinutes(w.end - w.start) : ''}
                </Text>
                <Pressable
                  onPress={() => setWakings((cur) => cur.filter((_, j) => j !== i))}
                  hitSlop={8}
                  accessibilityLabel={t('night.removeWaking')}
                  className="w-8 h-8 rounded-full border border-line-strong items-center justify-center"
                >
                  <Xmark color={colors.inkMuted} size={12} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={addWaking} accessibilityRole="button" className="flex-row items-center px-3.5 py-3.5">
              <Plus color={colors.violetSoft} size={14} />
              <Text className="text-violet-soft font-medium ml-2.5">{t('night.addWaking')}</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <PayloadEditor payload={payload} onChange={patch} />
      <CommonFields payload={payload} onChange={patch} />

      {error ? <ErrorText className="mt-3">{error}</ErrorText> : null}
      <Button label={t('common.save')} onPress={save} disabled={!changed || !!error} />
      <Button label={night.pieces.length > 1 ? t('night.deleteTitle') : t('common.delete')} variant="dangerQuiet" onPress={confirmDelete} />
    </ScreenScroll>
  );
}
