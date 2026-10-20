import '../global.css';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initDatabase } from '../db/client';
import { useChildStore } from '../store/useChildStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLogStore } from '../store/useLogStore';
import { useActiveChild } from '../store/useActiveChild';
import { useReminderSync } from '../features/reminders/scheduler';

const BG = '#020617';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasChild = useChildStore((s) => s.children.length > 0);
  const activeChild = useActiveChild();
  const loadLogs = useLogStore((s) => s.loadLogs);

  useEffect(() => {
    (async () => {
      await initDatabase();
      await Promise.all([useSettingsStore.getState().hydrate(), useChildStore.getState().hydrate()]);
      setReady(true);
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useReminderSync(ready);

  useEffect(() => {
    if (activeChild) loadLogs(activeChild.id);
  }, [activeChild?.id, loadLogs]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }} className="justify-center items-center px-8">
        <StatusBar style="light" />
        {error ? (
          <Text className="text-red-400 text-center">Failed to open database: {error}</Text>
        ) : (
          <ActivityIndicator size="large" color="#a78bfa" />
        )}
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BG },
          headerStyle: { backgroundColor: BG },
          headerTintColor: '#e2e8f0',
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
          <Stack.Screen name="child/[id]/index" options={{ headerShown: true, title: 'Child', headerBackTitle: 'Back' }} />
          <Stack.Screen name="child/[id]/edit" options={{ presentation: 'modal', headerShown: true, title: 'Edit' }} />
          <Stack.Screen name="reminders" options={{ headerShown: true, title: 'Reminders', headerBackTitle: 'Settings' }} />
        </Stack.Protected>
        <Stack.Protected guard={!hasChild}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        {/* Reachable from onboarding too, so it isn't guarded. */}
        <Stack.Screen name="import/babybuddy" options={{ headerShown: true, title: 'Import' }} />
      </Stack>
    </>
  );
}
