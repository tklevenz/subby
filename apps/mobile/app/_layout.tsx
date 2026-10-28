import '../global.css';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { appReady } from '../features/startup';
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

  useEffect(() => {
    appReady()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => SplashScreen.hideAsync().catch(() => {}));
  }, []);

  useReminderSync(ready);
  useSyncEngine(ready);

  useEffect(() => {
    if (activeChild) loadLogs(activeChild.id);
  }, [activeChild?.id, loadLogs]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground }} className="justify-center items-center px-8">
        <StatusBar style="light" />
        {error ? <Text className="text-red-strong text-center">Failed to open database: {error}</Text> : null}
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.ground },
          headerStyle: { backgroundColor: colors.ground },
          headerTintColor: colors.inkLight,
        }}
      >
        <Stack.Protected guard={hasChild}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="entry/[id]" options={{ presentation: 'modal', headerShown: true, title: 'Edit entry' }} />
          <Stack.Screen name="growth" options={{ headerShown: true, title: 'Growth', headerBackTitle: 'Trends' }} />
          <Stack.Screen name="solids" options={{ headerShown: true, title: 'Solids', headerBackTitle: 'Trends' }} />
          <Stack.Screen name="export" options={{ headerShown: true, title: 'Export CSV', headerBackTitle: 'Trends' }} />
          <Stack.Screen name="schedule" options={{ headerShown: true, title: 'Sleep schedule' }} />
          <Stack.Screen name="child/new" options={{ presentation: 'modal', headerShown: true, title: 'Add child' }} />
          <Stack.Screen name="child/[id]/index" options={{ headerShown: false }} />
          <Stack.Screen name="child/[id]/edit" options={{ presentation: 'modal', headerShown: true, title: 'Edit' }} />
          <Stack.Screen name="reminders" options={{ headerShown: true, title: 'Reminders', headerBackTitle: 'Settings' }} />
          <Stack.Screen name="sync/index" options={{ headerShown: true, title: 'Sync', headerBackTitle: 'Settings' }} />
          <Stack.Screen name="sync/add" options={{ headerShown: true, title: 'Add a phone' }} />
          <Stack.Screen name="sync/recovery" options={{ headerShown: true, title: 'Recovery key' }} />
        </Stack.Protected>
        <Stack.Protected guard={!hasChild}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        {/* Reachable from onboarding too, so they aren't guarded. */}
        <Stack.Screen name="import/babybuddy" options={{ headerShown: true, title: 'Import' }} />
        <Stack.Screen name="backup" options={{ headerShown: true, title: 'Backup', headerBackTitle: 'Settings' }} />
        <Stack.Screen name="sync/join" options={{ headerShown: true, title: 'Join a family' }} />
        <Stack.Screen name="sync/recover" options={{ headerShown: true, title: 'Recover' }} />
      </Stack>
    </>
  );
}
