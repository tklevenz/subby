import '../global.css';
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
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
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
          <Stack.Screen name="entry/[id]" options={{ presentation: 'modal', headerShown: true, title: t('screen.editEntry') }} />
          <Stack.Screen name="growth" options={{ headerShown: true, title: t('screen.growth'), headerBackTitle: t('tabs.trends') }} />
          <Stack.Screen name="solids" options={{ headerShown: true, title: t('screen.solids'), headerBackTitle: t('tabs.trends') }} />
          <Stack.Screen name="export" options={{ headerShown: true, title: t('screen.export'), headerBackTitle: t('tabs.trends') }} />
          <Stack.Screen name="schedule" options={{ headerShown: true, title: t('screen.schedule') }} />
          <Stack.Screen name="child/new" options={{ presentation: 'modal', headerShown: true, title: t('screen.addChild') }} />
          <Stack.Screen name="child/[id]/index" options={{ headerShown: false }} />
          <Stack.Screen name="child/[id]/edit" options={{ presentation: 'modal', headerShown: true, title: t('screen.edit') }} />
          <Stack.Screen name="reminders" options={{ headerShown: true, title: t('screen.reminders'), headerBackTitle: t('tabs.settings') }} />
          <Stack.Screen name="sync/index" options={{ headerShown: true, title: t('screen.sync'), headerBackTitle: t('tabs.settings') }} />
          <Stack.Screen name="sync/add" options={{ headerShown: true, title: t('screen.addPhone') }} />
          <Stack.Screen name="sync/recovery" options={{ headerShown: true, title: t('screen.recoveryKey') }} />
          <Stack.Screen name="sync/move" options={{ headerShown: true, title: t('screen.move') }} />
        </Stack.Protected>
        <Stack.Protected guard={!hasChild}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        {/* Reachable from onboarding too, so they aren't guarded. */}
        <Stack.Screen name="import/babybuddy" options={{ headerShown: true, title: t('screen.import') }} />
        <Stack.Screen name="backup" options={{ headerShown: true, title: t('screen.backup'), headerBackTitle: t('tabs.settings') }} />
        <Stack.Screen name="sync/join" options={{ headerShown: true, title: t('screen.join') }} />
        <Stack.Screen name="sync/recover" options={{ headerShown: true, title: t('screen.recover') }} />
      </Stack>
    </>
  );
}
