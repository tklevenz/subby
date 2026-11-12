import { t } from '@subby/shared/i18n';
import { DAY_MS, formatSpan } from '@subby/shared';
import React from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { Notice } from './ui';
import { useSyncStore } from '../features/sync/state';

/** On Home while sync can't go on (removed from the family, or this phone's identity is gone): opens the Sync screen. */
export function SyncStopped() {
  const removed = useSyncStore((s) => s.removed);
  const identityLost = useSyncStore((s) => s.identityLost);
  const clockOff = useSyncStore((s) => s.clockOff);
  if (!removed && !identityLost) {
    // Not something the app can fix: the clock is set in the phone's settings.
    return clockOff !== null ? (
      <Notice className="mx-4 mb-2">
        <Text className="text-ink text-sm leading-5">{clockOffText(clockOff)}</Text>
      </Notice>
    ) : null;
  }
  return (
    <Notice className="mx-4 mb-2" onPress={() => router.push('/sync')}>
      <Text className="text-ink text-sm leading-5">{t(identityLost ? 'sync.error.identityLost' : 'sync.error.removed')}</Text>
      <Text className="text-amber-pale text-sm font-semibold mt-1">{t('home.syncStoppedOpen')}</Text>
    </Notice>
  );
}

/** "This phone's clock is off by 3h 10m …"; days once it's two or more. */
export function clockOffText(offMs: number) {
  const off = Math.abs(offMs);
  const span = off >= 2 * DAY_MS ? t('age.days', { count: Math.round(off / DAY_MS) }) : formatSpan(off);
  return t('sync.clockOff', { span });
}
