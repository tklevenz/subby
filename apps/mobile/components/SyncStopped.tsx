import { t } from '@subby/shared/i18n';
import React from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { Notice } from './ui';
import { useSyncStore } from '../features/sync/state';

/** On Home while sync can't go on (removed from the family, or this phone's identity is gone): opens the Sync screen. */
export function SyncStopped() {
  const removed = useSyncStore((s) => s.removed);
  const identityLost = useSyncStore((s) => s.identityLost);
  if (!removed && !identityLost) return null;
  return (
    <Notice className="mx-4 mb-2" onPress={() => router.push('/sync')}>
      <Text className="text-ink text-sm leading-5">{t(identityLost ? 'sync.error.identityLost' : 'sync.error.removed')}</Text>
      <Text className="text-amber-pale text-sm font-semibold mt-1">{t('home.syncStoppedOpen')}</Text>
    </Notice>
  );
}
