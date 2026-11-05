import React from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AngleRight, Plus } from '../../components/icons';
import { activeReminderCount, formatAge } from '@kindred-log/shared';
import { remindersAvailable, requestNotifications, setRemindersEnabled } from '../../features/reminders/scheduler';
import ChildAvatar from '../../components/ChildAvatar';
import { useActiveChild } from '../../store/useActiveChild';
import { useChildStore } from '../../store/useChildStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSyncStore } from '../../features/sync/engine';
import { Card, Row, Segmented } from '../../components/ui';
import { colors } from '../../theme/colors';
import { SubMono, Wordmark } from '../../components/brand/Sub';

/** Card in the children strip. Same slots for every card, so they line up. */
function ChildCard({
  avatar,
  title,
  subtitle,
  dashed,
  onPress,
}: {
  avatar: React.ReactNode;
  title: string;
  subtitle: string;
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
      <Text className="text-xs text-ink-muted" numberOfLines={1}>{subtitle || ' '}</Text>
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
  const units = useSettingsStore((s) => s.units);
  const clock = useSettingsStore((s) => s.clock);
  const reminders = useSettingsStore((s) => s.reminders);
  const reminderCount = activeReminderCount(reminders);
  const familyAlerts = useSettingsStore((s) => s.familyAlerts);
  const setFamilyAlerts = async (patch: Partial<typeof familyAlerts>) => {
    if (patch.enabled && !(await requestNotifications())) return;
    await setSetting('familyAlerts', { ...familyAlerts, ...patch });
  };
  const setSetting = useSettingsStore((s) => s.set);
  const chevron = <AngleRight color={colors.inkGhost} size={16} />;
  const sync = useSettingsStore((s) => s.sync);
  const syncPhase = useSyncStore((s) => s.phase);
  const syncLabel = !sync ? 'Off' : syncPhase === 'error' ? "Couldn't sync" : syncPhase === 'syncing' ? 'Syncing…' : 'On';

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
          subtitle=""
        />
      </ScrollView>

      <SectionTitle>Sync</SectionTitle>
      <Card>
        <Row label="Sync between phones" value={syncLabel} onPress={() => router.push('/sync')} right={chevron} />
      </Card>

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
      {sync ? (
        <View className="mt-3">
          <Card>
            <Row
              label="When another phone logs a sleep"
              right={<Switch value={familyAlerts.enabled} onValueChange={(enabled) => setFamilyAlerts({ enabled })} disabled={!remindersAvailable} />}
            />
            {familyAlerts.enabled ? (
              <>
                <Row label="And when they wake up" right={<Switch value={familyAlerts.wakeUps} onValueChange={(wakeUps) => setFamilyAlerts({ wakeUps })} />} />
                <Row label="Bedtime and morning too" right={<Switch value={familyAlerts.nights} onValueChange={(nights) => setFamilyAlerts({ nights })} />} />
              </>
            ) : null}
          </Card>
          <Text className="text-ink-ghost text-xs mt-2 mx-1 leading-5">
            Naps{familyAlerts.nights ? ', bedtime and the morning' : ''}, never night wakings. Each phone chooses for itself, so a grandparent's
            can stay quiet.{sync.push ? '' : " This server doesn't send pushes, so they only arrive while Subby is open."}
          </Text>
        </View>
      ) : null}

      <SectionTitle>Data</SectionTitle>
      <Card>
        <Row label="Backup & restore" onPress={() => router.push('/backup')} right={chevron} />
        <Row label="Export CSV" onPress={() => router.push('/export')} right={chevron} />
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

      <View className="mt-10 items-center">
        <View className="flex-row items-center">
          <SubMono width={26} color={colors.subYellow} />
          <Wordmark size={18} className="ml-1.5">
            subby
          </Wordmark>
        </View>
        <Text className="text-ink-ghost text-xs mt-1">
          Data stays on this device{Constants.expoConfig?.version ? ` · ${Constants.expoConfig.version}` : ''}
        </Text>
        {/* Required by the Font Awesome Free license (CC BY 4.0). */}
        <Text className="text-ink-ghost text-xs mt-1">Icons by Font Awesome (CC BY 4.0)</Text>
      </View>
    </ScrollView>
  );
}
