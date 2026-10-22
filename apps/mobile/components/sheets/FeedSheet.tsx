import React, { useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Minus, Pause, Plus } from '../icons';
import {
  formatVolume,
  isRunning,
  lastOfType,
  mlToOz,
  ozToMl,
  sideSeconds,
  suggestedNextSide,
  toggleSide,
  type LogEntry,
  type PayloadOf,
  type Side,
} from '@kindred-log/shared';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSheetStore } from '../../store/useSheetStore';
import { formatDuration, useNow } from '../../store/timeHelpers';
import DateTimeField from '../DateTimeField';
import FoodPicker from '../editors/FoodPicker';
import { Button, Chip, FieldLabel, Segmented } from '../ui';
import { colors } from '../../theme/colors';

type Tab = 'breast' | 'bottle' | 'solids';
type Feed = PayloadOf<'feed'>;
type RunningFeed = LogEntry & { payload: Feed };

const ML_PRESETS = [60, 90, 120, 150, 180];
const OZ_PRESETS = [2, 3, 4, 5, 6];

const mmss = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

function SideButton({ side, secs, active, hint, onPress }: { side: Side; secs: number; active: boolean; hint: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 items-center rounded-2xl border py-6 ${active ? 'bg-cyan/30 border-cyan-soft' : 'bg-raised border-line-strong'}`}
    >
      <Text className="text-ink-soft text-sm font-medium">{side === 'left' ? 'Left' : 'Right'}</Text>
      <Text className="text-ink text-3xl font-bold mt-1" style={{ fontVariant: ['tabular-nums'] }}>{mmss(secs)}</Text>
      <View className="flex-row items-center mt-1 h-4">
        {active ? <Pause color={colors.cyanPale} size={12} /> : null}
        <Text className="text-xs text-cyan-pale ml-1">{active ? 'tap to pause' : hint ? 'suggested' : ''}</Text>
      </View>
    </Pressable>
  );
}

function BreastTab({ running, onDone }: { running: RunningFeed | undefined; onDone: () => void }) {
  const logs = useLogStore((s) => s.logs);
  const { startTimer, updateLog, stopTimer, softDeleteLog } = useLogStore.getState();
  const open = useSheetStore((s) => s.open);
  const now = useNow();
  const next = suggestedNextSide(logs);

  const tap = async (side: Side) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const t = Date.now();
    if (running) await updateLog(running.id, { payload: toggleSide(running.payload, side, t) });
    else await startTimer(toggleSide({ type: 'feed', method: 'breast' }, side, t), t);
  };

  const secs = running ? sideSeconds(running.payload, now) : { left: 0, right: 0 };
  const active = running?.payload.timerSide;

  return (
    <View>
      <Text className="text-ink-muted text-sm mt-3 mb-3">
        {running
          ? `Feeding for ${formatDuration(now - running.startedAt)}. Tap the other side to switch.`
          : next ? `Last feed ended on the ${next === 'left' ? 'right' : 'left'}. Offer ${next} first.` : 'Tap a side to start the timer.'}
      </Text>
      <View className="flex-row gap-3">
        <SideButton side="left" secs={secs.left} active={active === 'left'} hint={!running && next === 'left'} onPress={() => tap('left')} />
        <SideButton side="right" secs={secs.right} active={active === 'right'} hint={!running && next === 'right'} onPress={() => tap('right')} />
      </View>

      {running ? (
        <>
          <Button
            label="Done"
            onPress={async () => {
              await stopTimer(running.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onDone();
            }}
          />
          <Button
            label="Discard"
            variant="ghost"
            onPress={() =>
              Alert.alert('Discard this feed?', undefined, [
                { text: 'Keep', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: () => softDeleteLog(running.id) },
              ])
            }
          />
        </>
      ) : (
        <Button label="Log a past feed instead" variant="ghost" onPress={() => open({ kind: 'log', type: 'feed', payload: { method: 'breast' } })} />
      )}
    </View>
  );
}

function BottleTab({ onDone }: { onDone: () => void }) {
  const logs = useLogStore((s) => s.logs);
  const addLog = useLogStore((s) => s.addLog);
  const units = useSettingsStore((s) => s.units);
  const metric = units === 'metric';

  // Default to the last bottle's milk type and amount.
  const last = useMemo(
    () => logs.find((l) => l.payload.type === 'feed' && l.payload.method === 'bottle')?.payload as Feed | undefined,
    [logs],
  );
  const [milkType, setMilkType] = useState<Feed['milkType']>(last?.milkType ?? 'breast_milk');
  const [amountMl, setAmountMl] = useState(last?.amountMl ?? 120);
  const [at, setAt] = useState(Date.now());

  const presets = metric ? ML_PRESETS : OZ_PRESETS.map(ozToMl);
  const step = metric ? 10 : ozToMl(0.5);
  const isPreset = (v: number) => Math.abs(v - amountMl) < 1;

  return (
    <View>
      <FieldLabel>Time</FieldLabel>
      <DateTimeField value={at} onChange={setAt} maximumDate={new Date()} />
      <FieldLabel>Milk</FieldLabel>
      <Segmented
        options={[{ value: 'breast_milk', label: 'Breast milk' }, { value: 'formula', label: 'Formula' }, { value: 'fortified', label: 'Fortified' }]}
        value={milkType}
        onChange={setMilkType}
      />
      <FieldLabel>Amount</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {presets.map((v) => (
          <Chip key={v} label={formatVolume(v, units)} selected={isPreset(v)} onPress={() => setAmountMl(v)} />
        ))}
      </View>
      <View className="flex-row items-center justify-center mt-3 gap-4">
        <Pressable onPress={() => setAmountMl((a) => Math.max(step, a - step))} className="w-10 h-10 rounded-full bg-raised border border-line-strong items-center justify-center">
          <Minus color={colors.inkMuted} size={18} />
        </Pressable>
        <Text className="text-lg font-bold text-ink w-24 text-center">
          {metric ? `${Math.round(amountMl)} ml` : `${Math.round(mlToOz(amountMl) * 2) / 2} oz`}
        </Text>
        <Pressable onPress={() => setAmountMl((a) => a + step)} className="w-10 h-10 rounded-full bg-raised border border-line-strong items-center justify-center">
          <Plus color={colors.inkMuted} size={18} />
        </Pressable>
      </View>
      <Button
        label={`Log ${formatVolume(amountMl, units)} bottle`}
        onPress={async () => {
          await addLog({ type: 'feed', method: 'bottle', milkType, amountMl }, { startedAt: at });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onDone();
        }}
      />
    </View>
  );
}

function SolidsTab({ onDone }: { onDone: () => void }) {
  const addLog = useLogStore((s) => s.addLog);
  const [solids, setSolids] = useState<Pick<Feed, 'foods' | 'allergen' | 'reaction'>>({});
  const [at, setAt] = useState(Date.now());

  return (
    <View>
      <FieldLabel>Time</FieldLabel>
      <DateTimeField value={at} onChange={setAt} maximumDate={new Date()} />
      <FoodPicker value={solids} onChange={(p) => setSolids((s) => ({ ...s, ...p }))} />
      <Button
        label="Log solids"
        onPress={async () => {
          await addLog({ type: 'feed', method: 'solids', ...solids }, { startedAt: at });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onDone();
        }}
      />
    </View>
  );
}

/** Feed logging: live breastfeeding timer, bottle presets, solids. */
export default function FeedSheet({ initialTab, onClose }: { initialTab?: Tab; onClose: () => void }) {
  const logs = useLogStore((s) => s.logs);
  const running = logs.find(
    (l): l is RunningFeed => l.payload.type === 'feed' && l.payload.method === 'breast' && isRunning(l),
  );
  const lastFeed = lastOfType(logs, 'feed');
  const [tab, setTab] = useState<Tab>(
    initialTab ?? (running ? 'breast' : (lastFeed?.payload.method as Tab | undefined) ?? 'breast'),
  );

  return (
    <>
      <Segmented
        options={[{ value: 'breast', label: 'Breast' }, { value: 'bottle', label: 'Bottle' }, { value: 'solids', label: 'Solids' }]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'breast' ? <BreastTab running={running} onDone={onClose} /> : null}
      {tab === 'bottle' ? <BottleTab onDone={onClose} /> : null}
      {tab === 'solids' ? <SolidsTab onDone={onClose} /> : null}
    </>
  );
}
