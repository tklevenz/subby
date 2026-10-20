import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import type { Child, LogType } from '@kindred-log/shared';
import ChildForm from '../../../components/ChildForm';
import { TYPE_META } from '../../../components/logTypes';
import { Button, FieldLabel, TextField } from '../../../components/ui';
import { countChildLogs, useChildStore } from '../../../store/useChildStore';
import { useLogStore } from '../../../store/useLogStore';
import { useSettingsStore } from '../../../store/useSettingsStore';

/** Edit a child's details; also home of the delete action. */
export default function EditChildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const child = useChildStore((s) => s.children.find((c) => c.id === id));
  const updateChild = useChildStore((s) => s.updateChild);

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: child ? `Edit ${child.name}` : 'Child' }} />
      {child ? (
        <>
          <ChildForm
            initial={child}
            submitLabel="Save"
            onSubmit={async (input) => {
              await updateChild(id, input);
              router.back();
            }}
          />
          <DeleteChild child={child} />
        </>
      ) : null}
    </ScrollView>
  );
}

/** Danger zone: permanent delete, confirmed by typing the child's name (as Baby Buddy does). */
function DeleteChild({ child }: { child: Child }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [counts, setCounts] = useState<Partial<Record<LogType, number>> | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) countChildLogs(child.id).then(setCounts);
  }, [open, child.id]);

  if (!open) {
    return (
      <View className="mt-10 pt-6 border-t border-slate-800">
        <Button label="Delete child…" variant="ghost" onPress={() => setOpen(true)} />
      </View>
    );
  }

  const total = counts ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : 0;
  const breakdown = counts
    ? (Object.entries(counts) as [LogType, number][])
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => `${n.toLocaleString()} ${TYPE_META[type].label.toLowerCase()}`)
        .join(' · ')
    : '';
  const matches = confirm.trim().toLowerCase() === child.name.trim().toLowerCase();

  const onDelete = async () => {
    setDeleting(true);
    const { children, deleteChild } = useChildStore.getState();
    const settings = useSettingsStore.getState();
    const logStore = useLogStore.getState();

    await deleteChild(child.id);
    if (logStore.activeChildId === child.id) useLogStore.setState({ logs: [], activeChildId: null });
    if (settings.activeChildId === child.id) {
      await settings.set('activeChildId', children.find((c) => c.id !== child.id)?.id ?? null);
    }
    // Leave both the edit and the profile screen. With no children left, the route
    // guard switches to onboarding on its own.
    if (router.canDismiss()) router.dismissAll();
  };

  return (
    <View className="mt-10 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
      <Text className="text-red-300 font-semibold text-base">Delete {child.name} permanently?</Text>
      <Text className="text-slate-300 mt-2 leading-5">
        {counts === null
          ? 'Counting entries…'
          : total === 0
            ? `${child.name}'s profile will be deleted.`
            : `${child.name}'s profile and all ${total.toLocaleString()} entries will be deleted from this device, including photos.`}
      </Text>
      {breakdown ? <Text className="text-slate-400 text-xs mt-2 leading-4">{breakdown}</Text> : null}
      <Text className="text-slate-300 mt-2 leading-5">This can't be undone.</Text>
      {child.importRef ? (
        <Text className="text-slate-400 text-xs mt-2 leading-4">Imported data can be imported again from Baby Buddy.</Text>
      ) : null}

      <FieldLabel>Type "{child.name}" to confirm</FieldLabel>
      <TextField value={confirm} onChangeText={setConfirm} placeholder={child.name} autoCapitalize="none" autoCorrect={false} />
      <Button label={deleting ? 'Deleting…' : 'Delete forever'} variant="danger" disabled={!matches || deleting || counts === null} onPress={onDelete} />
      <Button
        label="Cancel"
        variant="ghost"
        onPress={() => {
          setOpen(false);
          setConfirm('');
        }}
      />
    </View>
  );
}
