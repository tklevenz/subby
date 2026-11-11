import { t } from '@subby/shared/i18n';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { sameName, type Child, type LogType } from '@subby/shared';
import ChildForm from '../../../components/ChildForm';
import { TYPE_META } from '../../../components/logTypes';
import { Button, FieldLabel, TextField } from '../../../components/ui';
import { countChildLogs, useChildStore } from '../../../store/useChildStore';
import { useLogStore } from '../../../store/useLogStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { ScreenScroll } from '../../../components/ScreenScroll';

/** Edit a child's details; also home of the delete action. */
export default function EditChildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const child = useChildStore((s) => s.children.find((c) => c.id === id));
  const updateChild = useChildStore((s) => s.updateChild);

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: child ? t('childEdit.title', { name: child.name }) : t('childEdit.child') }} />
      {child ? (
        <>
          <ChildForm
            initial={child}
            submitLabel={t('common.save')}
            onSubmit={async (input) => {
              await updateChild(id, input);
              router.back();
            }}
          />
          <DeleteChild child={child} />
        </>
      ) : null}
    </ScreenScroll>
  );
}

/** Danger zone: permanent delete, confirmed by typing the child's name (as Baby Buddy does). */
function DeleteChild({ child }: { child: Child }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [counts, setCounts] = useState<Partial<Record<LogType, number>> | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) void countChildLogs(child.id).then(setCounts);
  }, [open, child.id]);

  if (!open) {
    return (
      <View className="mt-10 pt-6 border-t border-line">
        <Button label={t('childEdit.deleteButton')} variant="ghost" onPress={() => setOpen(true)} />
      </View>
    );
  }

  const total = counts ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : 0;
  const breakdown = counts
    ? (Object.entries(counts) as [LogType, number][])
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => t('childEdit.count', { count: n, type: TYPE_META[type].label }))
        .join(' · ')
    : '';
  const matches = sameName(confirm, child.name);

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
    <View className="mt-10 rounded-2xl border border-red/40 bg-red/10 p-4">
      <Text className="text-red-soft font-semibold text-base">{t('childEdit.deleteTitle', { name: child.name })}</Text>
      <Text className="text-ink-soft mt-2 leading-5">
        {counts === null
          ? t('childEdit.counting')
          : total === 0
            ? t('childEdit.profileOnly', { name: child.name })
            : t('childEdit.profileAndEntries', { name: child.name, count: total })}
      </Text>
      {breakdown ? <Text className="text-ink-muted text-xs mt-2 leading-4">{breakdown}</Text> : null}
      <Text className="text-ink-soft mt-2 leading-5">{t('childEdit.cantUndo')}</Text>
      {child.importRef ? (
        <Text className="text-ink-muted text-xs mt-2 leading-4">{t('childEdit.reimport')}</Text>
      ) : null}

      <FieldLabel>{t('childEdit.typeName', { name: child.name })}</FieldLabel>
      <TextField value={confirm} onChangeText={setConfirm} placeholder={child.name} autoCapitalize="none" autoCorrect={false} />
      <Button label={t(deleting ? 'childEdit.deleting' : 'childEdit.deleteForever')} variant="danger" disabled={!matches || deleting || counts === null} onPress={onDelete} />
      <Button
        label={t('common.cancel')}
        variant="ghost"
        onPress={() => {
          setOpen(false);
          setConfirm('');
        }}
      />
    </View>
  );
}
