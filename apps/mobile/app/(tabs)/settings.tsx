import React from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Plus } from 'lucide-react-native';
import { activeReminderCount, formatAge } from '@kindred-log/shared';
import { remindersAvailable, setRemindersEnabled } from '../../features/reminders/scheduler';
import ChildAvatar from '../../components/ChildAvatar';
import { useActiveChild } from '../../store/useActiveChild';
import { useChildStore } from '../../store/useChildStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Card, Row, Segmented } from '../../components/ui';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text className="text-xs font-semibold text-slate-400 uppercase mt-6 mb-2 ml-1">{children}</Text>;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const children = useChildStore((s) => s.children);
  const activeChild = useActiveChild();
  const units = useSettingsStore((s) => s.units);
  const clock = useSettingsStore((s) => s.clock);
  const isPremium = useSettingsStore((s) => s.isPremium);
  const reminders = useSettingsStore((s) => s.reminders);
  const reminderCount = activeReminderCount(reminders);
  const setSetting = useSettingsStore((s) => s.set);
  const chevron = <ChevronRight color="#475569" size={16} />;

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 32 }}>
      <Text className="text-xl font-bold text-white mt-2">Settings</Text>

      {/* Each child has their own profile page; this screen is for app-wide settings. */}
      <SectionTitle>Children</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {children.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => router.push(`/child/${c.id}`)}
            className="items-center w-28 py-4 px-2 rounded-2xl bg-slate-900 border border-slate-800"
          >
            <ChildAvatar child={c} size={64} ring={c.id === activeChild?.id} />
            <Text className="text-white font-semibold mt-2" numberOfLines={1}>{c.name}</Text>
            <Text className="text-slate-400 text-xs" numberOfLines={1}>{formatAge(c.birthDate, Date.now())}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => router.push('/child/new')}
          className="items-center justify-center w-28 py-4 px-2 rounded-2xl border border-dashed border-slate-700"
        >
          <View className="w-16 h-16 rounded-full bg-slate-800 items-center justify-center">
            <Plus color="#94a3b8" size={24} />
          </View>
          <Text className="text-slate-300 mt-2">Add child</Text>
        </Pressable>
      </ScrollView>

      <SectionTitle>Notifications</SectionTitle>
      <Card>
        <Row
          label="Reminders"
          right={<Switch value={reminders.enabled} onValueChange={setRemindersEnabled} disabled={!remindersAvailable} />}
        />
        <Row
          label="Choose reminders"
          value={!remindersAvailable ? 'Needs dev build' : !reminders.enabled ? 'Paused' : reminderCount ? `${reminderCount} on` : 'None'}
          onPress={() => router.push('/reminders')}
          right={chevron}
        />
      </Card>

      <SectionTitle>Data</SectionTitle>
      <Card>
        <Row label="Export CSV" value={isPremium ? undefined : 'Premium'} onPress={() => router.push('/export')} right={chevron} />
        <Row label="Import from Baby Buddy" onPress={() => router.push('/import/babybuddy')} right={chevron} />
      </Card>

      <SectionTitle>Units</SectionTitle>
      <Segmented
        options={[{ value: 'metric', label: 'Metric (ml, kg, °C)' }, { value: 'imperial', label: 'Imperial (oz, lb, °F)' }]}
        value={units}
        onChange={(v) => setSetting('units', v)}
      />

      <SectionTitle>Clock</SectionTitle>
      <Segmented
        options={[{ value: '24h', label: '24-hour' }, { value: '12h', label: '12-hour' }]}
        value={clock}
        onChange={(v) => setSetting('clock', v)}
      />

      {__DEV__ ? (
        <>
          <SectionTitle>Developer</SectionTitle>
          <Card>
            <Row label="Premium (stub)" right={<Switch value={isPremium} onValueChange={(v) => setSetting('isPremium', v)} />} />
          </Card>
        </>
      ) : null}

      <View className="mt-10 items-center">
        <Text className="text-slate-600 text-xs">Kindred Log · data stays on this device</Text>
      </View>
    </ScrollView>
  );
}
