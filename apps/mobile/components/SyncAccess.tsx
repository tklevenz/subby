import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { SyncAccess } from '@subby/shared/sync';
import { Button, Card, Row, Segmented } from './ui';
import { PRICE, buy, canBuy, refundLastTest, restore, useAccess, useAccessStore, useDevTools } from '../features/sync/access';
import { sessionFor, syncNow, useSyncStore } from '../features/sync/engine';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFormatTime, useNow } from '../store/timeHelpers';

const DAY = 24 * 60 * 60 * 1000;

/** A phone's access in the phone list (hosted only). */
export const ACCESS_LABEL: Record<SyncAccess, string | undefined> = {
  free: undefined,
  trial: 'Trial',
  unlock: 'Unlocked',
  slot: 'Gifted',
  grace: 'Trial over',
  readOnly: 'Not unlocked',
};

/** Runs a purchase-like call, then syncs, so what waited goes up right away. */
function useStoreAction() {
  const [busy, setBusy] = useState(false);
  const run = async (action: (api: ReturnType<typeof sessionFor>) => Promise<unknown>) => {
    const settings = useSettingsStore.getState().sync;
    if (!settings || busy) return;
    setBusy(true);
    try {
      await action(sessionFor(settings));
      syncNow().catch(() => {});
    } catch (e) {
      Alert.alert("That didn't work", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** The Sync screen's card: this phone's trial, grace, unlock or gift, and what to do about it. Nothing on a self-hosted server. */
export function AccessCard() {
  const access = useAccess();
  const entitlement = useAccessStore((s) => s.entitlement);
  const pending = useSyncStore((s) => s.pending);
  const formatTime = useFormatTime();
  const now = useNow(60_000);
  const { busy, run } = useStoreAction();
  if (!access || access === 'free') return null;

  const daysLeft = entitlement?.trialEndsAt ? Math.max(1, Math.ceil((entitlement.trialEndsAt - now) / DAY)) : null;
  const graceEnd = entitlement?.graceEndsAt ?? now;
  const until = `${new Date(graceEnd).toDateString() === new Date(now).toDateString() ? 'today' : 'tomorrow'} at ${formatTime(graceEnd)}`;
  const copy: Record<Exclude<SyncAccess, 'free'>, { title: string; body: string; tone: 'calm' | 'warn' }> = {
    trial: {
      title: daysLeft ? `Free trial · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left` : 'Free trial',
      body: `Every phone in your family syncs during the trial. After it, each phone needs Subby Sync unlocked: ${PRICE}, once. No subscription.`,
      tone: 'calm',
    },
    grace: {
      title: `Trial over · syncing until ${until}`,
      body: `Unlock this phone to keep sharing what you log, or ask someone in your family to gift it an unlock. Everything stays on the phone either way.`,
      tone: 'warn',
    },
    readOnly: {
      title: 'Not sharing what you log',
      body: `This phone still gets your family's entries, but what you log here stays on it${pending ? ` (${pending.toLocaleString()} waiting)` : ''} until it's unlocked. Nothing is lost.`,
      tone: 'warn',
    },
    unlock: { title: 'Unlocked', body: 'This phone syncs for good. Restoring on a new phone moves the unlock there.', tone: 'calm' },
    slot: { title: 'Unlocked by your family', body: 'Someone in your family gifted this phone its unlock.', tone: 'calm' },
  };
  const { title, body, tone } = copy[access];
  const needsUnlock = access === 'trial' || access === 'grace' || access === 'readOnly';

  return (
    <View className={`rounded-2xl px-4 py-4 mt-6 border ${tone === 'warn' ? 'bg-amber/10 border-amber/40' : 'bg-surface border-line'}`}>
      <Text className="text-ink text-base font-semibold">{title}</Text>
      <Text className="text-ink-soft text-[15px] leading-[22px] mt-1">{body}</Text>
      {needsUnlock ? (
        <>
          <Button label={`Unlock this phone · ${PRICE}`} variant={access === 'trial' ? 'ghost' : 'primary'} onPress={() => run((api) => buy(api, 'unlock'))} disabled={busy || !canBuy()} />
          <Pressable onPress={() => run(restore)} disabled={busy || !canBuy()} className="items-center mt-3" hitSlop={8}>
            <Text className={`text-violet-soft text-sm ${canBuy() ? '' : 'opacity-40'}`}>Restore a purchase</Text>
          </Pressable>
          <Text className="text-ink-faint text-xs text-center mt-2">
            {canBuy() ? 'Test store: nothing is charged.' : 'Buying comes with the store release.'}
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
      <Text className="text-ink-faint text-xs mt-2 ml-1 leading-4">
        {free
          ? `${free} unused ${free === 1 ? 'gift' : 'gifts'}: the next phone that joins is unlocked.`
          : waiting
            ? 'You can unlock a phone in your family for them. A gift goes to the phone without an unlock that joined first.'
            : 'A gift unlocks the next phone that joins, like a grandparent’s.'}
      </Text>
      <Button label={`Gift an unlock · ${PRICE}`} variant="ghost" onPress={() => run((api) => buy(api, 'slot'))} disabled={busy || !canBuy()} />
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
      ? 'What you log here isn’t shared with your family. Unlock this phone to sync it.'
      : `Your trial is over. This phone syncs until ${formatTime(entitlement?.graceEndsAt ?? Date.now())}, then needs an unlock.`;
  return (
    <Pressable onPress={() => router.push('/sync')} className="mx-4 mb-2 rounded-xl px-4 py-3 bg-amber/10 border border-amber/40">
      <Text className="text-ink text-sm leading-5">{text}</Text>
    </Pressable>
  );
}

/** Dev builds and test-store servers: pretend to be in any state, and refund test purchases. */
export function AccessDevTools() {
  const show = useDevTools();
  const pretend = useAccessStore((s) => s.pretend);
  const testStore = useAccessStore((s) => s.testPurchases);
  const hasTest = useAccessStore((s) => s.testTokens.length > 0);
  const { busy, run } = useStoreAction();
  if (!show) return null;
  const options: { value: SyncAccess | 'real'; label: string }[] = [
    { value: 'real', label: 'Real' },
    { value: 'trial', label: 'Trial' },
    { value: 'grace', label: 'Grace' },
    { value: 'readOnly', label: 'Locked' },
    { value: 'unlock', label: 'Own' },
    { value: 'slot', label: 'Gift' },
  ];
  return (
    <>
      <Text className="text-xs font-semibold text-ink-muted uppercase mt-8 mb-2 ml-1">Developer · sync access</Text>
      <Segmented options={options} value={pretend ?? 'real'} onChange={(v) => useAccessStore.setState({ pretend: v === 'real' ? null : (v as SyncAccess) })} />
      <Text className="text-ink-faint text-xs mt-2 ml-1">
        Pretends only on this screen and Home; the server decides what syncs.
        {testStore ? ' This server has the test store: buying here costs nothing.' : ''}
      </Text>
      {hasTest ? (
        <Card>
          <Row label="Refund the last test purchase" onPress={busy ? undefined : () => run(refundLastTest)} />
        </Card>
      ) : null}
    </>
  );
}
