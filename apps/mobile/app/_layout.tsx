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
        </Stack.Protected>
        <Stack.Protected guard={!hasChild}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Screen name="child/[id]" options={{ presentation: 'modal', headerShown: true, title: 'Child' }} />
      </Stack>
    </>
  );
}
