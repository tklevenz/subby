import '../global.css';
import { errorMessage } from '../features/errorMessage';
import { t } from '@subby/shared/i18n';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
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
import { Xmark } from '../components/icons';

// The native splash (the sub on navy) stays up until the database is open, so there's no spinner in between.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 250 });

/** Closes a modal screen: iOS shows no back button on one (Android does). */
function CloseButton() {
  return (
    <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}>
      <Xmark color={colors.inkLight} size={18} />
    </Pressable>
  );
}

/** A screen with the navigation header (the stack hides it by default); `modal` slides up, with a close button on iOS. */
const header = (title: string, more: { modal?: boolean } = {}) => ({
  headerShown: true,
  title,
  ...(more.modal ? { presentation: 'modal' as const, ...(Platform.OS === 'ios' ? { headerLeft: () => <CloseButton /> } : {}) } : {}),
});

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
          // A chevron, no previous title: iOS would show the tab group's route name ("(tabs)") or a stale one.
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Protected guard={hasChild}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="entry/[id]" options={header(t('screen.editEntry'), { modal: true })} />
          <Stack.Screen name="growth" options={header(t('screen.growth'))} />
          <Stack.Screen name="solids" options={header(t('screen.solids'))} />
          <Stack.Screen name="export" options={header(t('screen.export'))} />
          <Stack.Screen name="licenses" options={header(t('screen.licenses'))} />
          <Stack.Screen name="schedule" options={header(t('screen.schedule'))} />
          <Stack.Screen name="child/new" options={header(t('screen.addChild'), { modal: true })} />
          <Stack.Screen name="child/[id]/index" options={{ headerShown: false }} />
          <Stack.Screen name="child/[id]/edit" options={header(t('screen.edit'), { modal: true })} />
          <Stack.Screen name="reminders" options={header(t('screen.reminders'))} />
          <Stack.Screen name="sync/index" options={header(t('screen.sync'))} />
          <Stack.Screen name="sync/add" options={header(t('screen.addPhone'))} />
          <Stack.Screen name="sync/recovery" options={header(t('screen.recoveryKey'))} />
          <Stack.Screen name="sync/move" options={header(t('screen.move'))} />
        </Stack.Protected>
        <Stack.Protected guard={!hasChild}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        {/* Reachable from onboarding too, so they aren't guarded. */}
        <Stack.Screen name="import/babybuddy" options={header(t('screen.import'))} />
        <Stack.Screen name="backup" options={header(t('screen.backup'))} />
        <Stack.Screen name="sync/join" options={header(t('screen.join'))} />
        <Stack.Screen name="sync/recover" options={header(t('screen.recover'))} />
      </Stack>
    </>
  );
}
