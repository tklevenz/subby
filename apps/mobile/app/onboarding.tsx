import React from 'react';
import { ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChildForm from '../components/ChildForm';
import { useChildStore } from '../store/useChildStore';
import { useSettingsStore } from '../store/useSettingsStore';

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const addChild = useChildStore((s) => s.addChild);
  const setSetting = useSettingsStore((s) => s.set);

  return (
    <ScrollView
      className="flex-1 bg-slate-950"
      contentContainerStyle={{ paddingTop: insets.top + 32, paddingHorizontal: 20, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-3xl font-bold text-white">Welcome to Kindred Log</Text>
      <Text className="text-slate-400 mt-2 leading-6">
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
    </ScrollView>
  );
}
