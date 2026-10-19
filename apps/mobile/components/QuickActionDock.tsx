import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useLogStore } from '../store/useLogStore';
import { LogPayload } from '@kindred/shared';
import { Droplets, Moon, Baby } from 'lucide-react-native';

interface QuickBtnProps {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  bg: string;
  ring?: string;
  onPress: () => void;
}

function QuickBtn({ icon, label, sub, bg, onPress }: QuickBtnProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      className={`${bg} rounded-xl px-4 py-3 items-center justify-center min-w-24 flex-1`}
    >
      <View className="mb-1">{icon}</View>
      <Text className="text-white text-xs font-semibold">{label}</Text>
      {sub ? <Text className="text-slate-400 text-[10px] mt-0.5">{sub}</Text> : null}
    </TouchableOpacity>
  );
}

export default function QuickActionDock({
  onFeedPress,
  activeSleepId,
  onEndSleep,
}: {
  onFeedPress: () => void;
  activeSleepId: string | undefined;
  onEndSleep: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const addLog = useLogStore((s) => s.addLog);
  const updateLog = useLogStore((s) => s.updateLog);

  const tapDiaper = async (condition: 'wet' | 'dirty' | 'both') => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const payload: LogPayload = { type: 'diaper', condition };
    await addLog(payload);
  };

  const tapSleep = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const payload: LogPayload = { type: 'sleep', endedAt: null };
    await addLog(payload);
  };

  const tapWakeUp = async () => {
    if (!activeSleepId) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await updateLog(activeSleepId, { endedAt: Date.now() });
  };

  return (
    <View
      className="bg-slate-900/95 border-t border-slate-800 backdrop-blur"
      style={{ paddingBottom: insets.bottom + 4 }}
    >
      {/* Diaper row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-3 pt-2 gap-2">
        <QuickBtn
          icon={<Droplets color="#fbbf24" size={22} />}
          label="Wet"
          bg="bg-amber-500/20 border border-amber-500/30"
          onPress={() => tapDiaper('wet')}
        />
        <QuickBtn
          icon={<Droplets color="#a3e635" size={22} />}
          label="Dirty"
          bg="bg-lime-500/20 border border-lime-500/30"
          onPress={() => tapDiaper('dirty')}
        />
        <QuickBtn
          icon={<Droplets color="#fb923c" size={22} />}
          label="Both"
          bg="bg-orange-500/20 border border-orange-500/30"
          onPress={() => tapDiaper('both')}
        />
      </ScrollView>

      {/* Sleep + Feed row */}
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
          label="Log Feed"
          bg="bg-cyan-500/20 border border-cyan-500/30"
          onPress={onFeedPress}
        />
      </View>
    </View>
  );
}
