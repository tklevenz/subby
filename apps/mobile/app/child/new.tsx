import React from 'react';
import {} from 'react-native';
import { router } from 'expo-router';
import ChildForm from '../../components/ChildForm';
import { useChildStore } from '../../store/useChildStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { ScreenScroll } from '../../components/ScreenScroll';

/** Add another child; they become the active one. */
export default function NewChildScreen() {
  const addChild = useChildStore((s) => s.addChild);
  const setSetting = useSettingsStore((s) => s.set);
  return (
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <ChildForm
        submitLabel="Add child"
        onSubmit={async (input) => {
          const created = await addChild(input);
          await setSetting('activeChildId', created.id);
          router.back();
        }}
      />
    </ScreenScroll>
  );
}
