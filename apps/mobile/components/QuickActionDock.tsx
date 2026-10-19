import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLogStore } from '../store/useLogStore';
import { useSheetStore } from '../store/useSheetStore';
import { activeSleep, isRunning } from '@kindred-log/shared';
import { Droplets, Moon, Baby, Plus } from 'lucide-react-native';

interface QuickBtnProps {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  bg: string;
  onPress: () => void;
  onLongPress?: () => void;
  grow?: boolean;
}

function QuickBtn({ icon, label, sub, bg, onPress, onLongPress, grow = true }: QuickBtnProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      onLongPress={onLongPress}
      className={`${bg} rounded-xl px-3 py-3 items-center justify-center ${grow ? 'flex-1' : 'w-16'}`}
    >
      <View className="mb-1">{icon}</View>
      <Text className="text-white text-xs font-semibold">{label}</Text>
      {sub ? <Text className="text-slate-400 text-[10px] mt-0.5">{sub}</Text> : null}
    </TouchableOpacity>
  );
}

/** Thumb-zone actions: 1-tap diapers and sleep, feed sheet, "+" for everything else. */
export default function QuickActionDock() {
  const addLog = useLogStore((s) => s.addLog);
  const startTimer = useLogStore((s) => s.startTimer);
  const stopTimer = useLogStore((s) => s.stopTimer);
  const activeSleepId = useLogStore((s) => activeSleep(s.logs)?.id);
  const feeding = useLogStore((s) => s.logs.some((l) => l.logType === 'feed' && isRunning(l)));
  const open = useSheetStore((s) => s.open);

  const tapDiaper = async (condition: 'wet' | 'dirty' | 'both') => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await addLog({ type: 'diaper', condition });
  };
  // Long-press: same diaper but with details (color, time, notes).
  const detailDiaper = (condition: 'wet' | 'dirty' | 'both') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    open({ kind: 'log', type: 'diaper', payload: { condition } });
  };

  const tapSleep = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Daytime sleeps default to naps; editable afterwards.
    const hour = new Date().getHours();
    await startTimer({ type: 'sleep', nap: hour >= 7 && hour < 19 });
  };

  const tapWakeUp = async () => {
    if (!activeSleepId) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await stopTimer(activeSleepId);
  };

  return (
    <View className="bg-slate-900/95 border-t border-slate-800">
      <View className="flex-row px-3 pt-2 gap-2">
        <QuickBtn
          icon={<Droplets color="#fbbf24" size={22} />}
          label="Wet"
          bg="bg-amber-500/20 border border-amber-500/30"
          onPress={() => tapDiaper('wet')}
          onLongPress={() => detailDiaper('wet')}
        />
        <QuickBtn
          icon={<Droplets color="#a3e635" size={22} />}
          label="Dirty"
          bg="bg-lime-500/20 border border-lime-500/30"
          onPress={() => tapDiaper('dirty')}
          onLongPress={() => detailDiaper('dirty')}
        />
        <QuickBtn
          icon={<Droplets color="#fb923c" size={22} />}
          label="Both"
          bg="bg-orange-500/20 border border-orange-500/30"
          onPress={() => tapDiaper('both')}
          onLongPress={() => detailDiaper('both')}
        />
      </View>

      <View className="flex-row px-3 py-2 gap-2">
        {activeSleepId ? (
          <QuickBtn
            icon={<Moon color="#f472b6" size={22} />}
            label="Wake Up"
            sub="Tap to end sleep"
            bg="bg-pink-500/25 border border-pink-500/40"
            onPress={tapWakeUp}
          />
        ) : (
          <QuickBtn
            icon={<Moon color="#a78bfa" size={22} />}
            label="Start Sleep"
            bg="bg-violet-500/20 border border-violet-500/30"
            onPress={tapSleep}
          />
        )}
        <QuickBtn
          icon={<Baby color="#67e8f9" size={22} />}
          label={feeding ? 'Feeding…' : 'Log Feed'}
          bg={feeding ? 'bg-cyan-500/35 border border-cyan-300/60' : 'bg-cyan-500/20 border border-cyan-500/30'}
          onPress={() => open({ kind: 'feed' })}
        />
        <QuickBtn
          icon={<Plus color="#cbd5e1" size={22} />}
          label="More"
          bg="bg-slate-800 border border-slate-700"
          onPress={() => open({ kind: 'add' })}
          grow={false}
        />
      </View>
      <Text className="text-slate-600 text-[10px] text-center pb-1">Long-press a diaper for details</Text>
    </View>
  );
}
