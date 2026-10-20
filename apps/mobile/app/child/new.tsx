import React from 'react';
import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import ChildForm from '../../components/ChildForm';
import PremiumGate from '../../components/PremiumGate';
import { useCanAddChild, useChildStore } from '../../store/useChildStore';
import { useSettingsStore } from '../../store/useSettingsStore';

/** Add another child; they become the active one. */
export default function NewChildScreen() {
  const addChild = useChildStore((s) => s.addChild);
  const setSetting = useSettingsStore((s) => s.set);
  const canAdd = useCanAddChild();

  if (!canAdd) {
    return (
      <PremiumGate
        title="More children with Premium"
        description="The free version tracks one child. Premium adds siblings and twins, each with their own profile, history and reminders."
      />
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <ChildForm
        submitLabel="Add child"
        onSubmit={async (input) => {
          const created = await addChild(input);
          await setSetting('activeChildId', created.id);
          router.back();
        }}
      />
    </ScrollView>
  );
}
