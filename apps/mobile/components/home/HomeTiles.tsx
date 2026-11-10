import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { AngleRight, Baby, CalendarDays, ClockRotateLeft, Moon, PoopDroplet, Xmark, type IconComponent } from '../icons';
import {
  activeSleep,
  describeDiaper,
  describeFeed,
  formatDuration,
  formatHoursMinutes,
  formatRelative,
  groupNights,
  defaultNap,
  isNightWaking,
  isRunning,
  lastOfType,
  lastWakeAt,
  medicationsDue,
  predictNextSleep,
  pumpingDue,
  startOfDay,
  suggestedNextSide,
  type Child,
  type LogEntry,
} from '@subby/shared';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore, type HomeTile } from '../../store/useSettingsStore';
import { useSheetStore } from '../../store/useSheetStore';
import { TYPE_META } from '../logTypes';
import { SubMono, Sub } from '../brand/Sub';
import { DozingSub } from '../brand/loaders';
import { useFormatTime, useNow } from '../../store/timeHelpers';
import { colors } from '../../theme/colors';

const TILES: HomeTile[] = ['sleep', 'feed', 'diaper'];
const LABEL: Record<HomeTile, string> = { sleep: 'Sleep', feed: 'Feed', diaper: 'Diaper' };

type TileContent = {
  /** Small line above the value ("Awake for"). */
  eyebrow?: string;
  value: string;
  lines: string[];
  /** What a tap does, shown on the large tile. */
  hint: string;
  active?: boolean;
  onPress: () => void;
  /** A running timer started by mistake: delete it (asks first). */
  onDiscard?: () => void;
  /** The entry the time refers to (running, or the last one); tapping the time or its lines opens it. */
  entryId?: string;
};

/** A tap on a big tile can be taken back for a few seconds: the tile is easy to hit by accident. */
type UndoOffer = { label: string; undo: () => void; /** Sleep's: the bar carries the sub. */ sub?: boolean };
const UNDO_MS = 5000;

/**
 * Home: the pinned tile on top (sleep by default), the other two side by side below, then
 * what's due and links. Long-press a tile to pin it; saved per child.
 */
export default function HomeTiles({ child }: { child: Child }) {
  const logs = useLogStore((s) => s.logs);
  const homeTop = useSettingsStore((s) => s.homeTop);
  const setSetting = useSettingsStore((s) => s.set);
  const now = useNow();
  const top = homeTop[child.id] ?? 'sleep';
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const offerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const offerUndo = (o: UndoOffer) => {
    clearTimeout(offerTimer.current);
    setOffer(o);
    offerTimer.current = setTimeout(() => setOffer(null), UNDO_MS);
  };
  useEffect(() => () => clearTimeout(offerTimer.current), []);
  const content = useTileContent(logs, child, now, offerUndo);

  const longPress = (tile: HomeTile) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (tile === top) {
      Alert.alert(`${LABEL[tile]} is the top tile`, 'Long-press another tile to move it to the top.');
      return;
    }
    Alert.alert(LABEL[tile], undefined, [
      { text: 'Make this the top tile', onPress: () => setSetting('homeTop', { ...homeTop, [child.id]: tile }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const others = TILES.filter((t) => t !== top);
  return (
    <View className="flex-1 px-4 pb-3 gap-2.5">
      <Tile tile={top} large content={content[top]} onLongPress={() => longPress(top)} />
      <View className="flex-1 flex-row gap-2.5">
        {others.map((t) => (
          <Tile key={t} tile={t} content={content[t]} onLongPress={() => longPress(t)} />
        ))}
      </View>
      <UpNext logs={logs} now={now} offerUndo={offerUndo} />
      {offer ? (
        <View className="absolute left-4 right-4 bottom-3 flex-row items-center bg-raised border border-line-strong rounded-xl pl-4 pr-1.5 py-1.5">
          {offer.sub ? (
            <View className="mr-2.5">
              <Sub width={34} />
            </View>
          ) : null}
          <Text className="flex-1 text-ink text-sm" numberOfLines={1}>
            {offer.label}
          </Text>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              clearTimeout(offerTimer.current);
              setOffer(null);
              offer.undo();
            }}
            className="px-4 py-2.5 rounded-lg"
          >
            <Text className="text-violet-soft text-sm font-semibold">Undo</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function useTileContent(logs: LogEntry[], child: Child, now: number, offerUndo: (o: UndoOffer) => void): Record<HomeTile, TileContent> {
  const formatTime = useFormatTime();
  const startTimer = useLogStore((s) => s.startTimer);
  const stopTimer = useLogStore((s) => s.stopTimer);
  const updateLog = useLogStore((s) => s.updateLog);
  const softDeleteLog = useLogStore((s) => s.softDeleteLog);
  const open = useSheetStore((s) => s.open);
  const minute = Math.floor(now / 60_000);
  const prediction = useMemo(() => predictNextSleep(logs, child, minute * 60_000), [logs, child, minute]);
  // Awake in the night: how long they've slept tonight instead of a prediction.
  const tonight = useMemo(
    () => (isNightWaking(logs, minute * 60_000) ? groupNights(logs, minute * 60_000).at(-1) : undefined),
    [logs, minute],
  );

  // "2h 15m ago" → value "2h 15m", first line "ago · <detail>".
  const since = (at: number, detail: string) => {
    const rel = formatRelative(now - at);
    return rel.endsWith(' ago') ? { value: rel.slice(0, -4), first: `ago · ${detail}` } : { value: rel, first: detail };
  };

  const sleeping = activeSleep(logs);
  const wakeAt = lastWakeAt(logs);
  let sleep: TileContent;
  if (sleeping) {
    sleep = {
      value: formatDuration(now - sleeping.startedAt),
      lines: [`${sleeping.payload.nap ? 'napping' : 'asleep'} · since ${formatTime(sleeping.startedAt)}`],
      hint: 'Tap to wake up',
      active: true,
      entryId: sleeping.id,
      onPress: async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const slept = formatHoursMinutes(Date.now() - sleeping.startedAt);
        await stopTimer(sleeping.id);
        offerUndo({ label: `Woke up after ${slept}`, undo: () => updateLog(sleeping.id, { endedAt: null }), sub: true });
      },
      onDiscard: () =>
        Alert.alert('Discard this sleep?', "It's deleted, as if it never started.", [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => softDeleteLog(sleeping.id) },
        ]),
    };
  } else {
    const lines: string[] = [];
    if (tonight) {
      lines.push(`slept ${formatHoursMinutes(tonight.asleepMs)} tonight, since ${formatTime(tonight.start)}`);
    } else if (prediction?.kind === 'nap') {
      lines.push(`Down for nap ${prediction.napIndex + 1} around ${formatTime(prediction.earliest)}–${formatTime(prediction.latest)}`);
      if (prediction.napMinutes) lines.push(`Naps usually ~${formatHoursMinutes(prediction.napMinutes * 60_000)}`);
    } else if (prediction) {
      lines.push(`Bedtime around ${formatTime(prediction.earliest)}–${formatTime(prediction.latest)}`);
    }
    sleep = {
      value: wakeAt !== null ? formatHoursMinutes(now - wakeAt) : '–',
      lines: wakeAt !== null ? [`awake · since ${formatTime(wakeAt)}`, ...lines] : ['No sleep logged yet'],
      hint: 'Tap to start sleep',
      entryId: logs.find((l) => l.logType === 'sleep' && l.endedAt !== null)?.id,
      onPress: async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        // Nap or night from the usual bedtime (else the clock); editable afterwards.
        const entry = await startTimer({ type: 'sleep', nap: defaultNap(logs, Date.now()) });
        offerUndo({ label: 'Sleep started', undo: () => softDeleteLog(entry.id), sub: true });
      },
    };
  }

  const runningFeed = logs.find((l) => l.logType === 'feed' && isRunning(l));
  const lastFeed = logs.find((l) => l.logType === 'feed' && l.endedAt !== null);
  const side = suggestedNextSide(logs);
  let feed: TileContent;
  if (runningFeed?.payload.type === 'feed') {
    feed = {
      eyebrow: 'Feeding',
      value: formatDuration(now - runningFeed.startedAt),
      lines: [describeFeed(runningFeed.payload)],
      hint: 'Tap for sides',
      active: true,
      entryId: runningFeed.id,
      onPress: () => open({ kind: 'feed', tab: 'breast' }),
    };
  } else if (lastFeed?.payload.type === 'feed') {
    const s = since(lastFeed.startedAt, describeFeed(lastFeed.payload));
    feed = {
      value: s.value,
      lines: [s.first, ...(side ? [`Breast next: ${side === 'left' ? 'Left' : 'Right'}`] : [])],
      hint: 'Tap to log a feed',
      entryId: lastFeed.id,
      onPress: () => open({ kind: 'feed' }),
    };
  } else {
    feed = { value: '–', lines: ['No feeds yet'], hint: 'Tap to log a feed', onPress: () => open({ kind: 'feed' }) };
  }

  const lastDiaper = lastOfType(logs, 'diaper');
  const today = logs.filter((l) => l.logType === 'diaper' && l.startedAt >= startOfDay(now)).length;
  const diaperPress = () => open({ kind: 'diaper' });
  let diaper: TileContent;
  if (lastDiaper) {
    const s = since(lastDiaper.startedAt, describeDiaper(lastDiaper.payload));
    diaper = { value: s.value, lines: [s.first, `${today} today`], hint: 'Tap to log a change', entryId: lastDiaper.id, onPress: diaperPress };
  } else {
    diaper = { value: '–', lines: ['No changes yet'], hint: 'Tap to log a change', onPress: diaperPress };
  }

  return { sleep, feed, diaper };
}

// The old quick-dock tints (20 % fill, 30 % border); a running timer gets stronger.
const STYLE: Record<HomeTile, { box: string; boxActive: string; label: string; icon: () => string; Icon: typeof Moon }> = {
  sleep: { box: 'bg-violet/20 border-violet/30', boxActive: 'bg-violet/30 border-violet-strong/60', label: 'text-violet-soft', icon: () => colors.violetStrong, Icon: Moon },
  feed: { box: 'bg-cyan/20 border-cyan/30', boxActive: 'bg-cyan/30 border-cyan-soft/60', label: 'text-cyan-soft', icon: () => colors.cyanSoft, Icon: Baby },
  diaper: { box: 'bg-amber/20 border-amber/30', boxActive: 'bg-amber/30 border-amber-strong/60', label: 'text-amber-strong', icon: () => colors.amberStrong, Icon: PoopDroplet },
};

function Tile({ tile, content, large, onLongPress }: { tile: HomeTile; content: TileContent; large?: boolean; onLongPress: () => void }) {
  const s = STYLE[tile];
  const [height, setHeight] = useState(0);
  // Discard sits in the bottom-right; a small tile has room only for a round ✕ beside the lines.
  const discard = content.onDiscard ? (
    <Pressable
      onPress={content.onDiscard}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Discard this ${LABEL[tile].toLowerCase()}`}
      className={`absolute right-4 bottom-4 rounded-full border border-line-strong bg-ground/40 ${large ? 'flex-row items-center px-3 py-1.5' : 'w-8 h-8 items-center justify-center'}`}
    >
      <Xmark color={colors.inkMuted} size={12} />
      {large ? <Text className="text-ink-muted text-xs ml-1.5">Discard</Text> : null}
    </Pressable>
  ) : null;
  // The tile's action is a full-size button underneath; the content on top lets taps through to it, except for
  // the time and its lines (open the entry) and Discard. Buttons nested inside a button don't reliably get their own taps.
  return (
    <View
      onLayout={tile === 'sleep' ? (e) => setHeight(e.nativeEvent.layout.height) : undefined}
      className={`flex-1 border justify-between overflow-hidden ${large ? 'rounded-3xl p-5' : 'rounded-3xl p-4'} ${content.active ? s.boxActive : s.box}`}
    >
      {tile === 'sleep' ? <SleepSub large={large} asleep={!!content.active} height={height} /> : null}
      <Pressable
        onPress={content.onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={`${LABEL[tile]}: ${[content.eyebrow, content.value, ...content.lines].filter(Boolean).join(', ')}`}
        accessibilityHint={`${content.hint}. Long-press to make this the top tile.`}
        className="absolute inset-0 rounded-3xl"
      />
      <View pointerEvents="none" className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <s.Icon color={s.icon()} size={20} />
          <Text className={`text-sm font-semibold ml-2 ${s.label}`}>{LABEL[tile]}</Text>
        </View>
        {large ? <Text className="text-ink-muted text-xs">{content.hint}</Text> : null}
      </View>
      <View pointerEvents="box-none">
        {/* The time and the lines below it open its entry (the running or last one). */}
        <Pressable
          onPress={content.entryId ? () => router.push(`/entry/${content.entryId}`) : undefined}
          // Nothing to open yet ("No feeds yet"): taps go through to the tile.
          pointerEvents={content.entryId ? 'auto' : 'none'}
          hitSlop={8}
          accessibilityRole={content.entryId ? 'link' : undefined}
          accessibilityLabel={content.entryId ? `Open this ${LABEL[tile].toLowerCase()} entry` : undefined}
          className="self-start"
        >
          {content.eyebrow ? (
            <Text className="text-[13px] font-medium text-ink-muted">
              {content.eyebrow}
            </Text>
          ) : null}
          <Text
            className={`text-ink font-bold ${large ? 'text-[44px] leading-[48px]' : 'text-[28px] leading-8'}`}
            style={{ fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {content.value}
          </Text>
          {content.lines.map((line) => (
            // Clear of a small tile's ✕ (a 12-hour "since 12:06 PM" is long enough to reach it).
            <Text key={line} className={`text-ink-muted text-xs mt-0.5 ${!large && content.onDiscard ? 'mr-9' : ''}`} numberOfLines={large ? 2 : 1}>
              {line}
            </Text>
          ))}
        </Pressable>
      </View>
      {discard}
    </View>
  );
}

/**
 * The sub on the sleep tile, behind the content: faint while awake, dozing while asleep. The large tile has room in
 * its bottom-right (above Discard while asleep); a small tile's free corner is the top-right.
 */
function SleepSub({ large, asleep, height }: { large?: boolean; asleep: boolean; height: number }) {
  if (asleep) {
    // Above Discard, below the header row: smaller on short tiles.
    const width = large ? Math.min(128, Math.max(72, (height - 110) * 1.375)) : 56;
    return (
      <View pointerEvents="none" className="absolute" style={large ? { right: 20, bottom: 64 } : { right: 12, top: 12 }}>
        <DozingSub width={width} bubbles={!!large} />
      </View>
    );
  }
  return (
    <View pointerEvents="none" className="absolute" style={[{ opacity: 0.08 }, large ? { right: -18, bottom: -14 } : { right: -8, top: 6 }]}>
      <SubMono width={large ? 170 : 64} color={colors.violetStrong} />
    </View>
  );
}

/** How long a due row stays after its time: a medicine or pumping that has stopped shouldn't linger. */
const DUE_FOR_MS = 12 * 3_600_000;

type Due = { key: string; label: string; dueAt: number; Icon: IconComponent; color: string; bg: string; action: string; onPress: () => void };

/**
 * What's due, each with its own button: medication doses logged with a next-dose interval, and pumping when its
 * reminder is on (the same time as the notification). Then the sleep schedule and today's full log.
 */
function UpNext({ logs, now, offerUndo }: { logs: LogEntry[]; now: number; offerUndo: (o: UndoOffer) => void }) {
  const formatTime = useFormatTime();
  const open = useSheetStore((s) => s.open);
  const startTimer = useLogStore((s) => s.startTimer);
  const softDeleteLog = useLogStore((s) => s.softDeleteLog);
  const pumpReminder = useSettingsStore((s) => s.reminders.pumping);
  const today = logs.filter((l) => l.startedAt >= startOfDay(now)).length;

  const due: Due[] = medicationsDue(logs).map((m) => {
    const { name, dose, unit, nextDoseIntervalMin } = m.last;
    return {
      ...TYPE_META.medication,
      key: `med:${m.name}`,
      label: m.name,
      dueAt: m.dueAt,
      action: 'Log',
      onPress: () => open({ kind: 'log', type: 'medication', payload: { name, dose, unit, nextDoseIntervalMin } }),
    };
  });
  const pump = pumpReminder.enabled ? pumpingDue(logs, pumpReminder.intervalMin) : null;
  if (pump) {
    due.push({
      ...TYPE_META.pumping,
      key: 'pumping',
      dueAt: pump.dueAt,
      action: 'Start',
      onPress: async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const entry = await startTimer({ type: 'pumping' });
        offerUndo({ label: 'Pumping started', undo: () => softDeleteLog(entry.id) });
      },
    });
  }
  const shown = due.filter((d) => now - d.dueAt < DUE_FOR_MS).sort((a, b) => a.dueAt - b.dueAt);

  return (
    <View className="bg-surface border border-line rounded-2xl">
      {shown.map(({ key, label, dueAt, Icon, color, bg, action, onPress }) => (
        <View key={key} className="flex-row items-center pl-3.5 pr-2 py-2 border-b border-line">
          <Icon color={color} size={16} />
          <Text className="flex-1 text-ink text-sm ml-2.5" numberOfLines={1}>{label}</Text>
          <Text className={`text-xs ${dueAt <= now ? 'text-red-soft' : 'text-ink-muted'}`}>
            {dueAt <= now ? `Overdue by ${formatDuration(now - dueAt)}` : startOfDay(dueAt) > startOfDay(now) ? `Due tomorrow ${formatTime(dueAt)}` : `Due at ${formatTime(dueAt)}`}
          </Text>
          <Pressable onPress={onPress} accessibilityLabel={`${action} ${label.toLowerCase()}`} className={`ml-3 px-3.5 py-1.5 rounded-lg border ${bg}`}>
            <Text className="text-ink text-[13px] font-semibold">{action}</Text>
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => router.push('/schedule')} className="flex-row items-center px-3.5 py-3 border-b border-line">
        <CalendarDays color={colors.violetSoft} size={16} />
        <Text className="flex-1 text-ink text-sm ml-2.5">Sleep schedule</Text>
        <AngleRight color={colors.inkGhost} size={16} />
      </Pressable>
      <Pressable onPress={() => router.push('/history')} className="flex-row items-center px-3.5 py-3">
        <ClockRotateLeft color={colors.inkSoft} size={16} />
        <Text className="flex-1 text-ink text-sm ml-2.5">Today's log</Text>
        <Text className="text-ink-muted text-xs mr-1">{today === 1 ? '1 entry' : `${today} entries`}</Text>
        <AngleRight color={colors.inkGhost} size={16} />
      </Pressable>
    </View>
  );
}
