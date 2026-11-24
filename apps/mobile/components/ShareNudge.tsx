import { t } from '@subby/shared/i18n';
import { DAY_MS } from '@subby/shared';
import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSettingsStore } from '../store/useSettingsStore';
import { useActiveChild } from '../store/useActiveChild';
import { Xmark } from './icons';
import { colors } from '../theme/colors';

/** How long after Home first shows a child without sync it suggests sharing (once). */
export const SHARE_NUDGE_AFTER_MS = 3 * DAY_MS;

/**
 * Home: one quiet card suggesting sync, a few days into using the app without it. Never again once dismissed or
 * once sync is set up (turning it off later doesn't bring it back). Sync otherwise lives under Settings.
 */
export function ShareNudge() {
  const hydrated = useSettingsStore((s) => s.hydrated);
  const syncing = useSettingsStore((s) => s.sync !== null);
  const nudge = useSettingsStore((s) => s.shareNudge);
  const set = useSettingsStore((s) => s.set);
  const child = useActiveChild();

  useEffect(() => {
    if (!hydrated) return;
    if (syncing && nudge !== 'done') void set('shareNudge', 'done');
    else if (!syncing && nudge === null && child) void set('shareNudge', Date.now());
  }, [hydrated, syncing, nudge, child, set]);

  if (syncing || typeof nudge !== 'number' || Date.now() - nudge < SHARE_NUDGE_AFTER_MS) return null;

  return (
    <View className="mx-4 mb-2 rounded-xl bg-violet/10 border border-violet/40 flex-row">
      <Pressable onPress={() => router.push('/sync')} className="flex-1 px-4 py-3" accessibilityRole="button">
        <Text className="text-ink text-sm leading-5">{child?.name ? t('nudge.share', { name: child.name }) : t('nudge.shareNoName')}</Text>
        <Text className="text-violet-soft text-sm font-semibold mt-1">{t('nudge.shareAction')}</Text>
      </Pressable>
      <Pressable
        onPress={() => void set('shareNudge', 'done')}
        hitSlop={8}
        className="px-3 pt-3"
        accessibilityRole="button"
        accessibilityLabel={t('nudge.dismiss')}
      >
        <Xmark size={14} color={colors.inkFaint} />
      </Pressable>
    </View>
  );
}
