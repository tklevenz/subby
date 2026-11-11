import { t } from '@subby/shared/i18n';
import { errorMessage } from '../../features/errorMessage';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AngleRight, Plus } from '../../components/icons';
import { activeReminderCount, formatAge } from '@subby/shared';
import { remindersAvailable, requestNotifications, setRemindersEnabled } from '../../features/reminders/scheduler';
import ChildAvatar from '../../components/ChildAvatar';
import { useActiveChild } from '../../store/useActiveChild';
import { useChildStore } from '../../store/useChildStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSyncStore } from '../../features/sync/state';
import { diagnostics } from '../../features/diagnostics';
import { Card, Row, Segmented, Toggle, SectionLabel } from '../../components/ui';
import { colors } from '../../theme/colors';
import { SubMono, Wordmark } from '../../components/brand/Sub';
import LanguagePicker, { languageLabel } from '../../components/LanguagePicker';

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

/** Shows the report first; it only leaves the phone if the person shares it (to support, by email). */
async function showDiagnostics() {
  const text = await diagnostics().catch((e: unknown) => t('settings.diagFailed', { error: errorMessage(e) }));
  Alert.alert(t('settings.diagTitle'), t('settings.diagNote', { report: text }), [
    { text: t('common.close'), style: 'cancel' },
    { text: t('settings.share'), onPress: () => void Share.share({ message: text }) },
  ]);
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const children = useChildStore((s) => s.children);
  const activeChild = useActiveChild();
  const units = useSettingsStore((s) => s.units);
  const clock = useSettingsStore((s) => s.clock);
  const syncing = useSettingsStore((s) => s.sync !== null);
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
  const syncLabel = t(!sync ? 'settings.syncOff' : syncPhase === 'error' ? 'settings.syncError' : syncPhase === 'syncing' ? 'settings.syncing' : 'settings.syncOn');
  const language = useSettingsStore((s) => s.language);
  const [pickingLanguage, setPickingLanguage] = useState(false);

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <Text className="text-xl font-bold text-ink mx-4 mt-2 mb-2">{t('tabs.settings')}</Text>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>

      {/* Each child has their own profile page; this screen is for app-wide settings. */}
      <SectionLabel className="mt-2 mb-2">{t('settings.children')}</SectionLabel>
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
          title={t('settings.addChild')}
          subtitle=""
        />
      </ScrollView>

      <SectionLabel>{t('settings.sync')}</SectionLabel>
      <Card>
        <Row label={t('settings.syncRow')} value={syncLabel} onPress={() => router.push('/sync')} right={chevron} />
      </Card>

      <SectionLabel>{t('settings.notifications')}</SectionLabel>
      <Card>
        <Row
          label={t('settings.reminders')}
          right={<Toggle value={reminders.enabled} onValueChange={setRemindersEnabled} disabled={!remindersAvailable} />}
        />
        <Row
          label={t('settings.chooseReminders')}
          value={
            !remindersAvailable
              ? t('settings.needsDevBuild')
              : !reminders.enabled
                ? t('settings.paused')
                : reminderCount
                  ? t('settings.remindersOn', { count: reminderCount })
                  : t('settings.none')
          }
          onPress={() => router.push('/reminders')}
          right={chevron}
        />
      </Card>
      {sync ? (
        <View className="mt-3">
          <Card>
            <Row
              label={t('settings.familySleep')}
              right={<Toggle value={familyAlerts.enabled} onValueChange={(enabled) => setFamilyAlerts({ enabled })} disabled={!remindersAvailable} />}
            />
            {familyAlerts.enabled ? (
              <>
                <Row label={t('settings.familyWake')} right={<Toggle value={familyAlerts.wakeUps} onValueChange={(wakeUps) => setFamilyAlerts({ wakeUps })} />} />
                <Row label={t('settings.familyNights')} right={<Toggle value={familyAlerts.nights} onValueChange={(nights) => setFamilyAlerts({ nights })} />} />
              </>
            ) : null}
          </Card>
          <Text className="text-ink-ghost text-xs mt-2 mx-1 leading-5">
            {t(familyAlerts.nights ? 'settings.familyNoteNights' : 'settings.familyNoteNaps')}
            {sync.push ? '' : t('settings.familyNoPush')}
          </Text>
        </View>
      ) : null}

      <SectionLabel>{t('settings.data')}</SectionLabel>
      <Card>
        <Row label={t('settings.backup')} onPress={() => router.push('/backup')} right={chevron} />
        <Row label={t('settings.export')} onPress={() => router.push('/export')} right={chevron} />
        <Row label={t('settings.import')} onPress={() => router.push('/import/babybuddy')} right={chevron} />
      </Card>

      <SectionLabel>{t('language.title')}</SectionLabel>
      <Card>
        <Row label={languageLabel(language)} onPress={() => setPickingLanguage(true)} right={chevron} />
      </Card>
      <LanguagePicker
        visible={pickingLanguage}
        value={language}
        onClose={() => setPickingLanguage(false)}
        onPick={(choice) => {
          setPickingLanguage(false);
          void setSetting('language', choice);
        }}
      />

      <SectionLabel>{t('settings.units')}</SectionLabel>
      <Segmented
        options={[{ value: 'metric', label: t('settings.metric') }, { value: 'imperial', label: t('settings.imperial') }]}
        value={units}
        onChange={(v) => setSetting('units', v)}
      />

      <SectionLabel>{t('settings.clock')}</SectionLabel>
      <Segmented
        options={[{ value: '24h', label: t('settings.24h') }, { value: '12h', label: t('settings.12h') }]}
        value={clock}
        onChange={(v) => setSetting('clock', v)}
      />

      <SectionLabel>{t('settings.help')}</SectionLabel>
      <Card>
        <Row label={t('settings.diagnostics')} onPress={showDiagnostics} right={chevron} />
      </Card>

      <View className="mt-10 items-center">
        <View className="flex-row items-center">
          <SubMono width={26} color={colors.subYellow} />
          <Wordmark size={18} className="ml-1.5">
            subby
          </Wordmark>
        </View>
        <Text className="text-ink-ghost text-xs mt-1">
          {Constants.expoConfig?.version
            ? t('settings.version', { text: t(syncing ? 'settings.e2ee' : 'settings.local'), version: Constants.expoConfig.version })
            : t(syncing ? 'settings.e2ee' : 'settings.local')}
        </Text>
        {/* Required by the Font Awesome Free license (CC BY 4.0). */}
        <Text className="text-ink-ghost text-xs mt-1">{t('settings.icons')}</Text>
      </View>
      </ScrollView>
    </View>
  );
}
