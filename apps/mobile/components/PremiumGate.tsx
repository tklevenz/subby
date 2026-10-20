import React from 'react';
import { ScrollView, Text } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { Button } from './ui';

/** Full-screen upsell shown in place of a Premium feature. */
export default function PremiumGate({ title, description }: { title: string; description: string }) {
  const setSetting = useSettingsStore((s) => s.set);
  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 20 }}>
      <Text className="text-white text-lg font-semibold">{title}</Text>
      <Text className="text-slate-400 mt-2 leading-6">{description}</Text>
      <Text className="text-slate-500 mt-4">Premium isn't available yet.</Text>
      {__DEV__ ? <Button label="Enable Premium (dev build)" variant="ghost" onPress={() => setSetting('isPremium', true)} /> : null}
    </ScrollView>
  );
}
