import React from 'react';
import { Alert, ScrollView } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import ChildForm from '../../components/ChildForm';
import { Button } from '../../components/ui';
import { useChildStore } from '../../store/useChildStore';
import { useSettingsStore } from '../../store/useSettingsStore';

/** Add (`/child/new`) or edit a child profile. */
export default function ChildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const child = useChildStore((s) => s.children.find((c) => c.id === id));
  const { addChild, updateChild, softDeleteChild } = useChildStore.getState();
  const childCount = useChildStore((s) => s.children.length);
  const setSetting = useSettingsStore((s) => s.set);

  const confirmDelete = () => {
    if (!child) return;
    Alert.alert(`Remove ${child.name}?`, 'Their profile is hidden. Logged entries are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await softDeleteChild(child.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: isNew ? 'Add child' : (child?.name ?? 'Child') }} />
      {isNew || child ? (
        <ChildForm
          initial={child}
          submitLabel={isNew ? 'Add child' : 'Save'}
          onSubmit={async (input) => {
            if (isNew) {
              const created = await addChild(input);
              await setSetting('activeChildId', created.id);
            } else {
              await updateChild(id, input);
            }
            router.back();
          }}
        />
      ) : null}
      {!isNew && child && childCount > 1 ? (
        <Button label="Remove child" variant="danger" onPress={confirmDelete} />
      ) : null}
    </ScrollView>
  );
}
