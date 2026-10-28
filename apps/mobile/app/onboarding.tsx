import React from 'react';
import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChildForm from '../components/ChildForm';
import { Button } from '../components/ui';
import { useChildStore } from '../store/useChildStore';
import { useSettingsStore } from '../store/useSettingsStore';

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const addChild = useChildStore((s) => s.addChild);
  const setSetting = useSettingsStore((s) => s.set);

  return (
    <ScrollView
      className="flex-1 bg-ground"
      contentContainerStyle={{ paddingTop: insets.top + 32, paddingHorizontal: 20, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-3xl font-bold text-ink">Welcome to Subby</Text>
      <Text className="text-ink-muted mt-2 leading-6">
        Private, offline baby tracking. Everything stays on this device. Let's start with your little one.
      </Text>
      <ChildForm
        submitLabel="Get started"
        onSubmit={async (input) => {
          const child = await addChild(input);
          await setSetting('activeChildId', child.id);
          // The protected route guard swaps to the tabs once a child exists.
        }}
      />
      <Text className="text-ink-faint text-center mt-8">Another phone in your family already uses Subby?</Text>
      <Button label="Join a family" variant="ghost" onPress={() => router.push('/sync/join')} />

      <Text className="text-ink-faint text-center mt-6">Coming from Baby Buddy?</Text>
      <Button label="Import from Baby Buddy" variant="ghost" onPress={() => router.push('/import/babybuddy')} />

      <Text className="text-ink-faint text-center mt-6">Have a Subby backup?</Text>
      <Button label="Restore a backup" variant="ghost" onPress={() => router.push('/backup')} />
    </ScrollView>
  );
}
