import { t } from '@subby/shared/i18n';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check, type IconProps } from '../icons';
import { diaperLook } from '../logTypes';
import { hasStool, type DiaperColor, type DiaperCondition, type LogEntry } from '@subby/shared';
import { useLogStore } from '../../store/useLogStore';
import { useSheetStore } from '../../store/useSheetStore';
import { useFormatTime, useNow } from '../../store/timeHelpers';
import { DiaperColors } from '../editors/DiaperColors';
import { Button } from '../ui';
import { colors } from '../../theme/colors';
import { useSingleFlight } from '../useSingleFlight';

type Condition = Exclude<DiaperCondition, 'dry'>;

// Wet is blue, dirty brown; both is neutral and lets its two colored icons say it.
const kinds = (): { condition: Condition; label: string; className: string; Icon: (p: IconProps) => React.ReactNode }[] => [
  { condition: 'wet', label: t('diaper.wet'), className: 'bg-blue/20 border-blue/40', Icon: diaperLook('wet').Icon },
  { condition: 'dirty', label: t('diaper.dirty'), className: 'bg-brown/30 border-brown-strong/50', Icon: diaperLook('dirty').Icon },
  { condition: 'both', label: t('diaper.both'), className: 'bg-raised border-line-strong', Icon: diaperLook('both').Icon },
];
const AUTO_CLOSE_MS = 5000;

/** One tap logs a diaper now; then an optional color, Undo, and it closes by itself. */
export default function DiaperSheet({ onClose }: { onClose: () => void }) {
  const addLog = useLogStore((s) => s.addLog);
  const updateLog = useLogStore((s) => s.updateLog);
  const softDeleteLog = useLogStore((s) => s.softDeleteLog);
  const open = useSheetStore((s) => s.open);
  const formatTime = useFormatTime();
  const now = useNow(30_000);
  const [logged, setLogged] = useState<LogEntry | null>(null);

  // Restarted by every change, so picking a color keeps the sheet open a little longer.
  useEffect(() => {
    if (!logged) return;
    const t = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [logged, onClose]);

  const once = useSingleFlight();
  // Undo has its own guard: a tap on it while a color is being saved must still count.
  const onceUndo = useSingleFlight();
  const log = once(async (condition: Condition) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLogged(await addLog({ type: 'diaper', condition }));
  });

  if (!logged || logged.payload.type !== 'diaper') {
    return (
      <View className="pt-1 pb-2">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-ink-muted text-sm">{t('diaperSheet.now', { time: formatTime(now) })}</Text>
          <Pressable hitSlop={10} onPress={() => open({ kind: 'log', type: 'diaper' })}>
            <Text className="text-violet-soft text-sm">{t('diaperSheet.earlier')}</Text>
          </Pressable>
        </View>
        <View className="flex-row gap-2.5">
          {kinds().map((k) => (
            <Pressable
              key={k.condition}
              onPress={() => log(k.condition)}
              className={`flex-1 h-24 rounded-2xl border items-center justify-center ${k.className}`}
            >
              <k.Icon size={28} />
              <Text className="text-ink text-base font-semibold mt-2">{k.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text className="text-ink-muted text-xs text-center mt-3">{t('diaperSheet.oneTap')}</Text>
      </View>
    );
  }

  const p = logged.payload;
  const label = kinds().find((k) => k.condition === p.condition)?.label ?? t('type.diaper');
  const setColor = once(async (color: DiaperColor | undefined) => {
    void Haptics.selectionAsync();
    const payload = { ...p, color };
    await updateLog(logged.id, { payload });
    setLogged({ ...logged, payload });
  });
  const undo = onceUndo(async () => {
    await softDeleteLog(logged.id);
    onClose();
  });

  return (
    <View className="pt-1 pb-2">
      <View className="flex-row items-center">
        <View className="w-10 h-10 rounded-full bg-green/15 border border-green/40 items-center justify-center">
          <Check color={colors.greenSoft} size={20} />
        </View>
        <View className="flex-1 ml-3">
          <Text className="text-ink text-base font-semibold">{t('diaperSheet.logged', { kind: label })}</Text>
          <Text className="text-ink-muted text-xs">
            {formatTime(logged.startedAt)}
            {p.color ? ` · ${t(`diaperColor.${p.color}`)}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={undo}
          className="h-9 px-4 rounded-full border border-line-strong bg-raised items-center justify-center"
        >
          <Text className="text-ink text-sm">{t('common.undo')}</Text>
        </Pressable>
      </View>

      {hasStool(p.condition) ? (
        <>
          <Text className="text-ink-muted text-xs font-medium mt-5 mb-2">{t('diaperSheet.color')}</Text>
          <DiaperColors variant="sheet" value={p.color} onChange={setColor} />
        </>
      ) : null}

      <Button label={t('common.done')} onPress={onClose} />
      <Text className="text-ink-faint text-xs text-center mt-2">{t('diaperSheet.closes')}</Text>
    </View>
  );
}
