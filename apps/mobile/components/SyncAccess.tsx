import { formatNumber, t } from '@subby/shared/i18n';
import { DAY_MS, MINUTE_MS } from '@subby/shared';
import { errorMessage } from '../features/errorMessage';
import { useAsyncAction } from '../features/useAsyncAction';
import React from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { SyncAccess } from '@subby/shared/sync';
import { Button, Card, Row, Segmented, SectionLabel, Hint } from './ui';
import { PRICE, buy, canBuy, refundLastTest, restore, useAccess, useAccessStore, useDevTools } from '../features/sync/access';
import { syncNow } from '../features/sync/engine';
import { sessionFor, useSyncStore } from '../features/sync/state';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFormatTime, useNow } from '../store/timeHelpers';


/** A phone's access in the phone list (hosted only). */
export const accessLabel = (access: SyncAccess): string | undefined => (access === 'free' ? undefined : t(`access.${access}`));

/** Runs a purchase-like call, then syncs, so what waited goes up right away. */
function useStoreAction() {
  const { run: runAction, busy } = useAsyncAction();
  const run = (action: (api: ReturnType<typeof sessionFor>) => Promise<unknown>) => {
    const settings = useSettingsStore.getState().sync;
    if (!settings) return Promise.resolve(false);
    return runAction(
      async () => {
        await action(sessionFor(settings));
        syncNow().catch(() => {});
      },
      (e) => Alert.alert(t('access.failed'), errorMessage(e)),
    );
  };
  return { busy, run };
}

/** The Sync screen's card: this phone's trial, grace, unlock or gift, and what to do about it. Nothing on a self-hosted server. */
/**
 * Hosted: the family's photos on the server against its allowance (2 GB, D2), with a note once it's nearly or
 * completely full (new photos then stay on the phones; entries still sync).
 */
export function PhotoStorage() {
  const entitlement = useAccessStore((s) => s.entitlement);
  if (!entitlement?.photoLimit) return null;
  const { photoBytes: used, photoLimit: limit } = entitlement;
  const share = used / limit;
  return (
    <>
      <Row label={t('access.photos')} value={t('access.photosValue', { used: formatBytes(used), limit: formatBytes(limit) })} />
      {share >= 1 ? (
        <Text className="text-amber-soft text-sm mx-4 mb-3 leading-5">
          {t('access.photosFull')}
        </Text>
      ) : share >= 0.9 ? (
        <Text className="text-amber-soft text-sm mx-4 mb-3 leading-5">
          {t('access.photosNearly')}
        </Text>
      ) : null}
    </>
  );
}

const formatBytes = (n: number) =>
  n >= 1024 ** 3
    ? t('access.gb', { n: formatNumber(n / 1024 ** 3, { maximumFractionDigits: 1 }) })
    : t('access.mb', { n: Math.max(n > 0 ? 1 : 0, Math.round(n / 1024 ** 2)) });

export function AccessCard() {
  const access = useAccess();
  const entitlement = useAccessStore((s) => s.entitlement);
  const pending = useSyncStore((s) => s.pending);
  const formatTime = useFormatTime();
  const now = useNow(MINUTE_MS);
  const { busy, run } = useStoreAction();
  if (!access || access === 'free') return null;

  // A few minutes' slack: `now` ticks once a minute and clocks differ, so a fresh 14-day trial doesn't read 15.
  const daysLeft = entitlement?.trialEndsAt ? Math.max(1, Math.ceil((entitlement.trialEndsAt - now - 5 * MINUTE_MS) / DAY_MS)) : null;
  const graceEnd = entitlement?.graceEndsAt ?? now;
  const until = t(new Date(graceEnd).toDateString() === new Date(now).toDateString() ? 'access.untilToday' : 'access.untilTomorrow', { time: formatTime(graceEnd) });
  const copy: Record<Exclude<SyncAccess, 'free'>, { title: string; body: string; tone: 'calm' | 'warn' }> = {
    trial: {
      title: daysLeft ? t('access.trialLeft', { count: daysLeft }) : t('access.trialTitle'),
      body: t('access.trialBody', { price: PRICE }),
      tone: 'calm',
    },
    grace: {
      title: t('access.graceTitle', { until }),
      body: t('access.graceBody'),
      tone: 'warn',
    },
    readOnly: {
      title: t('access.readOnlyTitle'),
      body: pending ? t('access.readOnlyBodyWaiting', { count: pending }) : t('access.readOnlyBody'),
      tone: 'warn',
    },
    unlock: { title: t('access.unlockTitle'), body: t('access.unlockBody'), tone: 'calm' },
    slot: { title: t('access.slotTitle'), body: t('access.slotBody'), tone: 'calm' },
  };
  const { title, body, tone } = copy[access];
  const needsUnlock = access === 'trial' || access === 'grace' || access === 'readOnly';

  return (
    <View className={`rounded-2xl px-4 py-4 mt-6 border ${tone === 'warn' ? 'bg-amber/10 border-amber/40' : 'bg-surface border-line'}`}>
      <Text className="text-ink text-base font-semibold">{title}</Text>
      <Text className="text-ink-soft text-[15px] leading-[22px] mt-1">{body}</Text>
      {needsUnlock ? (
        <>
          <Button label={t('access.unlockButton', { price: PRICE })} variant={access === 'trial' ? 'ghost' : 'primary'} onPress={() => run((api) => buy(api, 'unlock'))} disabled={busy || !canBuy()} />
          <Pressable onPress={() => run(restore)} disabled={busy || !canBuy()} className="items-center mt-3" hitSlop={8}>
            <Text className={`text-violet-soft text-sm ${canBuy() ? '' : 'opacity-40'}`}>{t('access.restore')}</Text>
          </Pressable>
          <Text className="text-ink-faint text-xs text-center mt-2">
            {t(canBuy() ? 'access.testStore' : 'access.storeLater')}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/** Under the phone list: gifting an unlock to the next phone without one (slots go in the order phones joined). */
export function GiftSlot() {
  const access = useAccess();
  const entitlement = useAccessStore((s) => s.entitlement);
  const { busy, run } = useStoreAction();
  if (!access || access === 'free' || !entitlement) return null;
  const waiting = entitlement.devices.filter((d) => d.access !== 'unlock' && d.access !== 'slot').length;
  const free = entitlement.freeSlots;
  return (
    <>
      <Hint className="ml-1 leading-4">
        {free
          ? t('access.unusedGifts', { count: free })
          : waiting
            ? t('access.giftWaiting')
            : t('access.giftNext')}
      </Hint>
      <Button label={t('access.giftButton', { price: PRICE })} variant="ghost" onPress={() => run((api) => buy(api, 'slot'))} disabled={busy || !canBuy()} />
    </>
  );
}

/** Home: shown only when what this phone logs isn't reaching the family (or soon won't). */
export function AccessBanner() {
  const access = useAccess();
  const entitlement = useAccessStore((s) => s.entitlement);
  const formatTime = useFormatTime();
  if (access !== 'readOnly' && access !== 'grace') return null;
  const text =
    access === 'readOnly'
      ? t('access.bannerReadOnly')
      : t('access.bannerGrace', { time: formatTime(entitlement?.graceEndsAt ?? Date.now()) });
  return (
    <Pressable onPress={() => router.push('/sync')} className="mx-4 mb-2 rounded-xl px-4 py-3 bg-amber/10 border border-amber/40">
      <Text className="text-ink text-sm leading-5">{text}</Text>
    </Pressable>
  );
}

const DEV = {
  title: 'Developer · sync access', // i18n-ignore
  pretends: 'Pretends only on this screen and Home; the server decides what syncs.', // i18n-ignore
  testStore: ' This server has the test store: buying here costs nothing.', // i18n-ignore
  refund: 'Refund the last test purchase', // i18n-ignore
};

/** Dev builds and test-store servers: pretend to be in any state, and refund test purchases. */
export function AccessDevTools() {
  const show = useDevTools();
  const pretend = useAccessStore((s) => s.pretend);
  const testStore = useAccessStore((s) => s.testPurchases);
  const hasTest = useAccessStore((s) => s.testTokens.length > 0);
  const { busy, run } = useStoreAction();
  if (!show) return null;
  // Developer tools stay in English (dev builds and test-store servers only).
  const options: { value: SyncAccess | 'real'; label: string }[] = [
    { value: 'real', label: 'Real' }, // i18n-ignore
    { value: 'trial', label: 'Trial' }, // i18n-ignore
    { value: 'grace', label: 'Grace' }, // i18n-ignore
    { value: 'readOnly', label: 'Locked' }, // i18n-ignore
    { value: 'unlock', label: 'Own' }, // i18n-ignore
    { value: 'slot', label: 'Gift' }, // i18n-ignore
  ];
  return (
    <>
      <SectionLabel>{DEV.title}</SectionLabel>
      <Segmented options={options} value={pretend ?? 'real'} onChange={(v) => useAccessStore.setState({ pretend: v === 'real' ? null : (v as SyncAccess) })} />
      <Hint className="ml-1">
        {DEV.pretends}
        {testStore ? DEV.testStore : ''}
      </Hint>
      {hasTest ? (
        <Card>
          <Row label={DEV.refund} onPress={busy ? undefined : () => run(refundLastTest)} />
        </Card>
      ) : null}
    </>
  );
}
