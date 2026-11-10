import React from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChildForm from '../components/ChildForm';
import { Button, Lead } from '../components/ui';
import { SubTile } from '../components/brand/Sub';
import { useChildStore } from '../store/useChildStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { ScreenScroll } from '../components/ScreenScroll';

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const addChild = useChildStore((s) => s.addChild);
  const setSetting = useSettingsStore((s) => s.set);

  return (
    <ScreenScroll
      className="flex-1 bg-ground"
      contentContainerStyle={{ paddingTop: insets.top + 32, paddingHorizontal: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <SubTile size={64} />
      <Text className="text-3xl font-bold text-ink mt-4">Welcome to Subby</Text>
      <Lead className="mt-2">
        Private baby tracking that works offline. Your log lives on this phone, and if you share it with family, it's encrypted so only your phones can read it. Let's start with your little one.
      </Lead>
      <ChildForm
        submitLabel="Get started"
        autoFocus={false}
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
    </ScreenScroll>
  );
}
