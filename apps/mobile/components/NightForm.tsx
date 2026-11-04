import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { formatHoursMinutes, nightPieces, type LogPayload, type Night, type PayloadOf, type Waking } from '@kindred-log/shared';
import DateTimeField from './DateTimeField';
import { PayloadEditor } from './editors';
import { CommonFields } from './sheets/LogSheet';
import { Button, FieldLabel } from './ui';
import NightBar from './NightBar';
import { Moon, Plus, Xmark } from './icons';
import { useLogStore } from '../store/useLogStore';
import { useSleepOverlap } from '../features/sleepOverlap';
import { useFormatTime } from '../store/timeHelpers';
import { colors } from '../theme/colors';

const MIN = 60_000;
/** A new waking: this long, in the middle of the night's longest stretch. */
const NEW_WAKING_MS = 15 * MIN;

/**
 * A finished night as one: bedtime, wake-up and the wakings between. Saving turns it back into sleep pieces,
 * reusing the existing entries in order, adding new ones for added wakings and deleting the ones a removed waking
 * joined (their notes and tags move to the first). Opened from any piece of the night.
 */
export default function NightForm({ night }: { night: Night }) {
  const updateLog = useLogStore((s) => s.updateLog);
  const addLog = useLogStore((s) => s.addLog);
  const softDeleteLog = useLogStore((s) => s.softDeleteLog);
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
      ? 'Wake-up must be after bedtime.'
      : !pieces
        ? 'Each waking must fit inside the night, without overlapping another.'
        : nap && wakings.length
          ? "A nap can't have wakings: remove them, or keep it a night."
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
    if (longest.end - longest.start < NEW_WAKING_MS + 2 * MIN) return;
    const mid = Math.round((longest.start + longest.end - NEW_WAKING_MS) / 2 / (5 * MIN)) * 5 * MIN;
    setWakings((cur) => [...cur, { start: mid, end: mid + NEW_WAKING_MS }].sort((a, b) => a.start - b.start));
  };

  const save = async () => {
    if (!pieces) return;
    const joined = night.pieces.slice(pieces.length);
    const notes = [payload.notes, ...joined.map((p) => p.payload.notes)].filter(Boolean).join('\n') || undefined;
    const tags = [...new Set([...(payload.tags ?? []), ...joined.flatMap((p) => p.payload.tags ?? [])])];
    const firstPayload = { ...payload, notes, tags: tags.length ? tags : undefined };
    for (const [i, { start, end }] of pieces.entries()) {
      const existing = night.pieces[i];
      if (!existing) await addLog({ type: 'sleep', nap: false }, { startedAt: start, endedAt: end });
      else if (i === 0) await updateLog(existing.id, { payload: firstPayload, startedAt: start, endedAt: end });
      else if (existing.startedAt !== start || existing.endedAt !== end) await updateLog(existing.id, { startedAt: start, endedAt: end });
    }
    for (const p of joined) await softDeleteLog(p.id);
    router.back();
  };

  const confirmDelete = () =>
    Alert.alert('Delete night', night.pieces.length > 1 ? 'This deletes the whole night, wakings included.' : 'Delete this sleep?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          for (const p of night.pieces) await softDeleteLog(p.id);
          router.back();
        },
      },
    ]);

  const asleep = (pieces ?? []).reduce((a, p) => a + p.end - p.start, 0);
  const longest = Math.max(0, ...(pieces ?? []).map((p) => p.end - p.start));

  return (
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: nap ? 'Sleep' : 'Night' }} />

      {pieces ? (
        <View className="bg-violet/10 border border-violet/40 rounded-2xl p-4">
          <View className="flex-row items-center">
            <Moon color={colors.violetStrong} size={14} />
            <Text className="text-violet-pale text-[13px] ml-2">{formatHoursMinutes(wakeUp - bedtime)} in bed</Text>
          </View>
          <Text className="text-ink text-[28px] leading-[32px] font-bold mt-1.5">{formatHoursMinutes(asleep)} asleep</Text>
          <View className="mt-2.5">
            <NightBar stretches={pieces} />
          </View>
          <View className="flex-row justify-between mt-1.5">
            <Text className="text-ink-muted text-xs">{formatTime(bedtime)}</Text>
            <Text className="text-ink-muted text-xs">
              {wakings.length ? `${wakings.length} waking${wakings.length === 1 ? '' : 's'} · longest ${formatHoursMinutes(longest)}` : 'no wakings'}
            </Text>
            <Text className="text-ink-muted text-xs">{formatTime(wakeUp)}</Text>
          </View>
        </View>
      ) : null}

      <View className="flex-row gap-3">
        <View className="flex-1">
          <FieldLabel>Bedtime</FieldLabel>
          <DateTimeField value={bedtime} onChange={setBedtime} maximumDate={new Date()} title="Bedtime" />
        </View>
        <View className="flex-1">
          <FieldLabel>Woke up</FieldLabel>
          <DateTimeField value={wakeUp} onChange={setWakeUp} maximumDate={new Date()} title="Woke up" />
        </View>
      </View>

      {!nap ? (
        <>
          <FieldLabel>Night wakings</FieldLabel>
          <View className="bg-surface border border-line rounded-2xl">
            {wakings.map((w, i) => (
              <View key={i} className="flex-row items-center gap-2 px-3 py-2.5 border-b border-line">
                <DateTimeField value={w.start} onChange={(start) => setWaking(i, { start })} title="Awake from" timeOnly />
                <Text className="text-ink-muted">–</Text>
                <DateTimeField value={w.end} onChange={(end) => setWaking(i, { end })} title="Back asleep" timeOnly />
                <Text className="flex-1 text-ink-muted text-xs ml-1" numberOfLines={1}>
                  {w.end > w.start ? formatHoursMinutes(w.end - w.start) : ''}
                </Text>
                <Pressable
                  onPress={() => setWakings((cur) => cur.filter((_, j) => j !== i))}
                  hitSlop={8}
                  accessibilityLabel="Remove this waking"
                  className="w-8 h-8 rounded-full border border-line-strong items-center justify-center"
                >
                  <Xmark color={colors.inkMuted} size={12} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={addWaking} accessibilityRole="button" className="flex-row items-center px-3.5 py-3.5">
              <Plus color={colors.violetSoft} size={14} />
              <Text className="text-violet-soft font-medium ml-2.5">Add a waking</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <PayloadEditor payload={payload} onChange={patch} />
      <CommonFields payload={payload} onChange={patch} />

      {error ? <Text className="text-red-strong mt-3">{error}</Text> : null}
      <Button label="Save" onPress={save} disabled={!changed || !!error} />
      <Button label={night.pieces.length > 1 ? 'Delete night' : 'Delete'} variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}
