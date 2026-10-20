import React from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Plus } from 'lucide-react-native';
import { activeReminderCount, formatAge } from '@kindred-log/shared';
import { remindersAvailable, setRemindersEnabled } from '../../features/reminders/scheduler';
import ChildAvatar from '../../components/ChildAvatar';
import { useActiveChild } from '../../store/useActiveChild';
import { useCanAddChild, useChildStore } from '../../store/useChildStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Card, Row, Segmented } from '../../components/ui';
import { colors } from '../../theme/colors';

/** Card in the children strip. Same slots for every card, so they line up. */
function ChildCard({
  avatar,
  title,
  subtitle,
  subtitleAccent,
  dashed,
  onPress,
}: {
  avatar: React.ReactNode;
  title: string;
  subtitle: string;
  subtitleAccent?: boolean;
  dashed?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`items-center w-28 py-4 px-2 rounded-2xl border ${dashed ? 'border-dashed border-line-strong' : 'bg-surface border-line'}`}
    >
      <View className="w-16 h-16">{avatar}</View>
      <Text className={`font-semibold mt-2 ${dashed ? 'text-ink-soft' : 'text-ink'}`} numberOfLines={1}>{title}</Text>
      {/* Always rendered (even empty) so every card has the same height. */}
      <Text className={`text-xs ${subtitleAccent ? 'text-violet-soft' : 'text-ink-muted'}`} numberOfLines={1}>{subtitle || ' '}</Text>
    </Pressable>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text className="text-xs font-semibold text-ink-muted uppercase mt-6 mb-2 ml-1">{children}</Text>;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const children = useChildStore((s) => s.children);
  const activeChild = useActiveChild();
  const canAddChild = useCanAddChild();
  const units = useSettingsStore((s) => s.units);
  const clock = useSettingsStore((s) => s.clock);
  const isPremium = useSettingsStore((s) => s.isPremium);
  const reminders = useSettingsStore((s) => s.reminders);
  const reminderCount = activeReminderCount(reminders);
  const setSetting = useSettingsStore((s) => s.set);
  const chevron = <ChevronRight color={colors.inkGhost} size={16} />;

  return (
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 32 }}>
      <Text className="text-xl font-bold text-ink mt-2">Settings</Text>

      {/* Each child has their own profile page; this screen is for app-wide settings. */}
      <SectionTitle>Children</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {children.map((c) => (
          <ChildCard
            key={c.id}
            onPress={() => router.push(`/child/${c.id}`)}
            avatar={<ChildAvatar child={c} size={64} ring={c.id === activeChild?.id} />}
            title={c.name}
            subtitle={formatAge(c.birthDate, Date.now())}
          />
        ))}
        <ChildCard
          dashed
          onPress={() => router.push('/child/new')}
          avatar={
            <View className="w-16 h-16 rounded-full bg-raised items-center justify-center">
              <Plus color={colors.inkMuted} size={24} />
            </View>
          }
          title="Add child"
          subtitle={canAddChild ? '' : 'Premium'}
          subtitleAccent
        />
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
        <Text className="text-ink-ghost text-xs">Kindred Log · data stays on this device</Text>
      </View>
    </ScrollView>
  );
}
