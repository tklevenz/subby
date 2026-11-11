import '../global.css';
import { errorMessage } from '../features/errorMessage';
import { t } from '@subby/shared/i18n';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useLocales } from 'expo-localization';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { appReady } from '../features/startup';
import { applyLanguage, useLocale } from '../features/i18n';
import { useSettingsStore } from '../store/useSettingsStore';
import { useChildStore } from '../store/useChildStore';
import { useLogStore } from '../store/useLogStore';
import { useActiveChild } from '../store/useActiveChild';
import { useReminderSync } from '../features/reminders/scheduler';
import { useSyncEngine } from '../features/sync/useSyncEngine';
import { colors } from '../theme/colors';

// The native splash (the sub on navy) stays up until the database is open, so there's no spinner in between.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 250 });

/** A screen with the navigation header (the stack hides it by default). */
const header = (title: string, more: { presentation?: 'modal'; headerBackTitle?: string } = {}) => ({ headerShown: true, title, ...more });

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasChild = useChildStore((s) => s.children.length > 0);
  const activeChild = useActiveChild();
  const loadLogs = useLogStore((s) => s.loadLogs);
  const locale = useLocale((s) => s.locale);
  const language = useSettingsStore((s) => s.language);
  // The phone's language changed while the app was open (Android may keep the activity).
  const systemLocales = useLocales();
  useEffect(() => {
    if (language === 'system') applyLanguage('system');
  }, [language, systemLocales]);

  useEffect(() => {
    appReady()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => SplashScreen.hideAsync().catch(() => {}));
  }, []);

  useReminderSync(ready);
  useSyncEngine(ready);

  const activeChildId = activeChild?.id;
  useEffect(() => {
    if (activeChildId) void loadLogs(activeChildId);
  }, [activeChildId, loadLogs]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }} className="justify-center items-center px-8">
        <StatusBar style="light" />
        {error ? <Text className="text-red-strong text-center">{t('startup.dbFailed', { error })}</Text> : null}
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {/* Keyed by the language, so every screen renders again in it. */}
      <Stack
        key={locale}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.ground },
          headerStyle: { backgroundColor: colors.ground },
          headerTintColor: colors.inkLight,
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Stack.Protected guard={hasChild}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="entry/[id]" options={header(t('screen.editEntry'), { presentation: 'modal' })} />
          <Stack.Screen name="growth" options={header(t('screen.growth'), { headerBackTitle: t('tabs.trends') })} />
          <Stack.Screen name="solids" options={header(t('screen.solids'), { headerBackTitle: t('tabs.trends') })} />
          <Stack.Screen name="export" options={header(t('screen.export'), { headerBackTitle: t('tabs.trends') })} />
          <Stack.Screen name="schedule" options={header(t('screen.schedule'))} />
          <Stack.Screen name="child/new" options={header(t('screen.addChild'), { presentation: 'modal' })} />
          <Stack.Screen name="child/[id]/index" options={{ headerShown: false }} />
          <Stack.Screen name="child/[id]/edit" options={header(t('screen.edit'), { presentation: 'modal' })} />
          <Stack.Screen name="reminders" options={header(t('screen.reminders'), { headerBackTitle: t('tabs.settings') })} />
          <Stack.Screen name="sync/index" options={header(t('screen.sync'), { headerBackTitle: t('tabs.settings') })} />
          <Stack.Screen name="sync/add" options={header(t('screen.addPhone'))} />
          <Stack.Screen name="sync/recovery" options={header(t('screen.recoveryKey'))} />
          <Stack.Screen name="sync/move" options={header(t('screen.move'))} />
        </Stack.Protected>
        <Stack.Protected guard={!hasChild}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        {/* Reachable from onboarding too, so they aren't guarded. */}
        <Stack.Screen name="import/babybuddy" options={header(t('screen.import'))} />
        <Stack.Screen name="backup" options={header(t('screen.backup'), { headerBackTitle: t('tabs.settings') })} />
        <Stack.Screen name="sync/join" options={header(t('screen.join'))} />
        <Stack.Screen name="sync/recover" options={header(t('screen.recover'))} />
      </Stack>
    </>
  );
}
