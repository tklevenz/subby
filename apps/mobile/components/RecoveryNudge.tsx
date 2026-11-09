import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSyncStore } from '../features/sync/engine';
import { useSettingsStore } from '../store/useSettingsStore';
import { useActiveChild } from '../store/useActiveChild';
import { Xmark } from './icons';
import { colors } from '../theme/colors';

/** How long after setting up sync Home starts suggesting a recovery key (the setup flow offers it first). */
export const RECOVERY_NUDGE_AFTER_MS = 3 * 24 * 3_600_000;

/**
 * Home: one quiet card when this phone is the family's only copy and there's no recovery key, a few days after
 * setting up sync. It goes away for good once dismissed, once a key exists, or when a second phone joins.
 */
export function RecoveryNudge() {
  const sync = useSettingsStore((s) => s.sync);
  const alone = useSyncStore((s) => s.members.length === 1);
  const hasRecovery = useSyncStore((s) => s.hasRecovery);
  const child = useActiveChild();
  if (!sync || !alone || hasRecovery || sync.recoveryNudgeDismissed) return null;
  if (sync.since !== undefined && Date.now() - sync.since < RECOVERY_NUDGE_AFTER_MS) return null;

  const dismiss = () => {
    const current = useSettingsStore.getState().sync;
    if (current) void useSettingsStore.getState().set('sync', { ...current, recoveryNudgeDismissed: true });
  };

  return (
    <View className="mx-4 mb-2 rounded-xl bg-violet/10 border border-violet/40 flex-row">
      <Pressable onPress={() => router.push('/sync/recovery')} className="flex-1 px-4 py-3" accessibilityRole="button">
        <Text className="text-ink text-sm leading-5">
          Only this phone has {child?.name ? `${child.name}'s` : 'your'} log. A recovery key gets it back if the phone is ever lost.
        </Text>
        <Text className="text-violet-soft text-sm font-semibold mt-1">Create a recovery key</Text>
      </Pressable>
      <Pressable onPress={dismiss} hitSlop={8} className="px-3 pt-3" accessibilityRole="button" accessibilityLabel="Dismiss">
        <Xmark size={14} color={colors.inkFaint} />
      </Pressable>
    </View>
  );
}
