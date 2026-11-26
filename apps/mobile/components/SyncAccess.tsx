import { formatNumber, t } from '@subby/shared/i18n';
import { DAY_MS, MINUTE_MS, addDays, startOfDay } from '@subby/shared';
import { errorMessage } from '../features/errorMessage';
import { useAsyncAction } from '../features/useAsyncAction';
import React from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { GRACE_MS, type EntitlementResponse, type SyncAccess } from '@subby/shared/sync';
import { Button, Card, Row, Segmented, SectionLabel, Hint, LinkButton } from './ui';
import { UnlockInUse, buy, canBuy, refundLastTest, restore, restoreQuietly, useAccess, useAccessStore, useCanBuy, useDevTools, usePrice, useStoreUnavailable } from '../features/sync/access';
import { PurchaseCancelled, PurchasePending, requestSandboxRefund, sandboxUnlock } from '../features/sync/store';
import { syncNow } from '../features/sync/engine';
import { removeDevice } from '../features/sync/family';
import { sessionFor, useSyncStore } from '../features/sync/state';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFormatTime, useNow, weekdayDate } from '../store/timeHelpers';


/** A phone's access in the phone list (hosted only). */
export const accessLabel = (access: SyncAccess): string | undefined => (access === 'free' ? undefined : t(`access.${access}`));

/** Runs a purchase-like call, then syncs, so what waited goes up right away. */
function useStoreAction() {
  const { run: runAction, busy } = useAsyncAction();
  const giftPrice = usePrice('slot');
  const run = (action: (api: ReturnType<typeof sessionFor>) => Promise<unknown>): Promise<unknown> => {
    const settings = useSettingsStore.getState().sync;
    if (!settings) return Promise.resolve(false);
    return runAction(
      async () => {
        await action(sessionFor(settings));
        syncNow().catch(() => {});
      },
      (e) => {
        if (e instanceof PurchaseCancelled) return;
        if (e instanceof UnlockInUse) askToMove(e, giftPrice, run);
        else if (e instanceof PurchasePending) Alert.alert(e.message);
        else Alert.alert(t('access.failed'), errorMessage(e));
      },
    );
  };
  return { busy, run };
}

/**
 * The store account's unlock is used by another phone (a partner on the same Apple ID or Google account, or this
 * phone before a reinstall): move it only when asked, and offer a gift for this phone instead when it would get it.
 */
function askToMove(
  e: UnlockInUse,
  giftPrice: string | null,
  run: (action: (api: ReturnType<typeof sessionFor>) => Promise<unknown>) => Promise<unknown>,
  onCancel?: () => void,
) {
  const name = e.deviceId ? useSettingsStore.getState().sync?.names?.[e.deviceId] : undefined;
  const gift = canBuy('slot') && nextGiftIsMine();
  const text = (name ? t('access.inUseNamed', { name }) : t('access.inUseOther')) + (gift ? t('access.inUseGift') : '');
  Alert.alert(
    t('access.inUseTitle'),
    text,
    [
      { text: t('common.cancel'), style: 'cancel', onPress: onCancel },
      ...(gift ? [{ text: giftPrice ? t('access.inUseGiftButton', { price: giftPrice }) : t('access.inUseGiftButtonNoPrice'), onPress: () => void run((api) => buy(api, 'slot')) }] : []),
      {
        text: t('access.inUseMove'),
        style: 'destructive' as const,
        onPress: () =>
          void run(async (api) => {
            await restore(api, { move: true });
            if (e.deviceId) askToRemoveOld(e.deviceId, name ?? t('syncScreen.phone'));
          }),
      },
    ],
    { cancelable: true, onDismiss: onCancel },
  );
}

/**
 * The unlock moved here from a phone in this family. Often that's this phone before a reset or reinstall, which
 * joined again as a new phone: its old entry stays in the list until removed, and gifts go to it first.
 */
function askToRemoveOld(deviceId: string, name: string) {
  Alert.alert(t('access.oldPhoneTitle', { name }), t('access.oldPhoneText'), [
    { text: t('access.oldPhoneKeep'), style: 'cancel' },
    {
      text: t('syncScreen.remove'),
      style: 'destructive',
      onPress: () => void removeDevice(deviceId).catch((err: unknown) => Alert.alert(t('syncScreen.removeFailed'), errorMessage(err))),
    },
  ]);
}

/** The Sync screen checks the store account once per app run (`useOfferRestore`). */
let offeredThisRun = false;

/**
 * Opening the Sync screen on a phone without an unlock: the store account's unlock moves here by itself when no
 * other phone holds it, so nobody has to find "Restore a purchase". Held by another phone: the move is offered
 * (never done silently: it may be a partner's phone on the same account), once per holder.
 */
function useOfferRestore(offerable: boolean, run: (action: (api: ReturnType<typeof sessionFor>) => Promise<unknown>) => Promise<unknown>) {
  const giftPrice = usePrice('slot');
  React.useEffect(() => {
    const settings = useSettingsStore.getState().sync;
    if (!offerable || offeredThisRun || !settings) return;
    offeredThisRun = true;
    void restoreQuietly(sessionFor(settings)).then((outcome) => {
      if (outcome === 'moved') return void syncNow().catch(() => {});
      if (!(outcome instanceof UnlockInUse)) return;
      const holder = outcome.deviceId ?? 'other';
      const { unlockOfferDeclined, set } = useSettingsStore.getState();
      if (unlockOfferDeclined === holder) return;
      askToMove(outcome, giftPrice, run, () => void set('unlockOfferDeclined', holder));
    });
    // `run` and the price change every render; the check runs once, when it becomes possible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerable]);
}

/**
 * This phone joined after the family's trial had ended: it never had a trial, so it isn't told its trial is over.
 * Its grace counts from joining then (`graceEndsAt` = joined + 48 h, later than the trial's end + 48 h).
 */
const joinedAfterTrial = (e: EntitlementResponse | null) =>
  e?.trialEndsAt != null && e.graceEndsAt != null && e.graceEndsAt - GRACE_MS > e.trialEndsAt;

const hasUnlock = (access: SyncAccess) => access === 'unlock' || access === 'slot';

/**
 * Add a phone, under the QR code (hosted): the trial starting with this phone, or after the trial, whether the new
 * phone is covered or what it'll need.
 */
export function AddPhoneNote() {
  const entitlement = useAccessStore((s) => s.entitlement);
  const now = useNow(MINUTE_MS);
  if (!entitlement?.trialEndsAt) return null;
  // The family's first second phone: the trial starts (over) when it joins.
  if (entitlement.trialStartsOnJoin) return <Hint className="text-center">{t('add.startsTrial')}</Hint>;
  if (now < entitlement.trialEndsAt) return null;
  return <Hint className="text-center">{t(entitlement.freeSlots ? 'add.getsGift' : 'add.afterTrial')}</Hint>;
}

/**
 * Add a phone, once added (hosted, after the trial): gift it its unlock now. Only when the gift would reach it:
 * slots go to the phones without one in the order they joined, so not while an earlier phone (this one too) has none.
 * Gone once it's covered (a free slot waiting for it, or its slot shows in the entitlement).
 */
export function GiftNewPhone({ deviceId }: { deviceId: string }) {
  const entitlement = useAccessStore((s) => s.entitlement);
  const { busy, run } = useStoreAction();
  const price = usePrice('slot');
  const buyable = useCanBuy('slot');
  const now = useNow(MINUTE_MS);
  if (!entitlement?.trialEndsAt || entitlement.trialStartsOnJoin || now < entitlement.trialEndsAt || entitlement.freeSlots) return null;
  const others = entitlement.devices.filter((d) => d.id !== deviceId);
  const added = entitlement.devices.find((d) => d.id === deviceId);
  if (others.some((d) => !hasUnlock(d.access)) || (added && hasUnlock(added.access))) return null;
  return (
    <>
      <Hint className="mt-6 leading-4">{t('add.giftText')}</Hint>
      <Button label={price ? t('access.giftButton', { price }) : t('access.giftButtonNoPrice')} variant="ghost" onPress={() => run((api) => buy(api, 'slot'))} disabled={busy || !buyable} />
    </>
  );
}

/** Whether a new gift would unlock this phone: slots go to the phones without one in the order they joined. */
function nextGiftIsMine() {
  const me = useSettingsStore.getState().sync?.deviceId;
  const next = useAccessStore.getState().entitlement?.devices.find((d) => !hasUnlock(d.access));
  return next !== undefined && next.id === me;
}

/**
 * "today at 10:34", "tomorrow at 10:34", else "Thu, Nov 26 at 10:34": grace lasts 48 h, so it often ends the day
 * after tomorrow.
 */
function useFormatUntil() {
  const formatTime = useFormatTime();
  return (at: number, now = Date.now()) => {
    const time = formatTime(at);
    const day = startOfDay(at);
    if (day === startOfDay(now)) return t('access.untilToday', { time });
    if (day === addDays(startOfDay(now), 1)) return t('access.untilTomorrow', { time });
    return t('access.untilDate', { date: weekdayDate(at, now), time });
  };
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
  const formatUntil = useFormatUntil();
  const now = useNow(MINUTE_MS);
  const { busy, run } = useStoreAction();
  const [restoring, setRestoring] = React.useState(false);
  const price = usePrice('unlock');
  const buyable = useCanBuy('unlock');
  const unavailable = useStoreUnavailable();
  const testStore = useAccessStore((s) => s.testPurchases);
  const needsUnlock = access === 'trial' || access === 'grace' || access === 'readOnly';
  useOfferRestore(needsUnlock && buyable, run);
  if (!access || access === 'free') return null;

  // A few minutes' slack: `now` ticks once a minute and clocks differ, so a fresh 14-day trial doesn't read 15.
  const daysLeft = entitlement?.trialEndsAt ? Math.max(1, Math.ceil((entitlement.trialEndsAt - now - 5 * MINUTE_MS) / DAY_MS)) : null;
  const until = formatUntil(entitlement?.graceEndsAt ?? now, now);
  const late = joinedAfterTrial(entitlement);
  const copy: Record<Exclude<SyncAccess, 'free'>, { title: string; body: string; tone: 'calm' | 'warn' }> = {
    trial: {
      title: daysLeft ? t('access.trialLeft', { count: daysLeft }) : t('access.trialTitle'),
      body: price ? t('access.trialBody', { price }) : t('access.trialBodyNoPrice'),
      tone: 'calm',
    },
    grace: late
      ? { title: t('access.graceLateTitle', { until }), body: t('access.graceLateBody'), tone: 'warn' }
      : { title: t('access.graceTitle', { until }), body: t('access.graceBody'), tone: 'warn' },
    readOnly: {
      title: t('access.readOnlyTitle'),
      body: pending ? t('access.readOnlyBodyWaiting', { count: pending }) : t('access.readOnlyBody'),
      tone: 'warn',
    },
    unlock: { title: t('access.unlockTitle'), body: t('access.unlockBody'), tone: 'calm' },
    slot: { title: t('access.slotTitle'), body: t('access.slotBody'), tone: 'calm' },
  };
  const { title, body, tone } = copy[access];
  const restorePurchase = () => {
    setRestoring(true);
    void run((api) => restore(api)).finally(() => setRestoring(false));
  };

  return (
    <View className={`rounded-2xl px-4 py-4 mt-6 border ${tone === 'warn' ? 'bg-amber/10 border-amber/40' : 'bg-surface border-line'}`}>
      <Text className="text-ink text-base font-semibold">{title}</Text>
      <Text className="text-ink-soft text-[15px] leading-[22px] mt-1">{body}</Text>
      {needsUnlock ? (
        <>
          <Button label={price ? t('access.unlockButton', { price }) : t('access.unlockButtonNoPrice')} variant={access === 'trial' ? 'ghost' : 'primary'} onPress={() => run((api) => buy(api, 'unlock'))} disabled={busy || !buyable} />
          <LinkButton label={t('access.restore')} onPress={restorePurchase} disabled={busy || !buyable} busy={busy && restoring} />
          {testStore || unavailable ? (
            <Text className="text-ink-faint text-xs text-center mt-2">{t(testStore ? 'access.testStore' : 'access.storeUnavailable')}</Text>
          ) : null}
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
  const price = usePrice('slot');
  const buyable = useCanBuy('slot');
  if (!access || access === 'free' || !entitlement) return null;
  const waiting = entitlement.devices.filter((d) => !hasUnlock(d.access)).length;
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
      <Button label={price ? t('access.giftButton', { price }) : t('access.giftButtonNoPrice')} variant="ghost" onPress={() => run((api) => buy(api, 'slot'))} disabled={busy || !buyable} />
    </>
  );
}

/** How long before the trial ends Home says so (on each phone without an unlock). */
export const TRIAL_WARN_MS = 3 * DAY_MS;

/**
 * The trial ends within `TRIAL_WARN_MS`. Not while the phone is alone: a second phone joining starts the trial
 * over, and until then there's nobody to share with.
 */
function trialEndsSoon(e: EntitlementResponse | null, now: number) {
  if (!e?.trialEndsAt || e.trialStartsOnJoin) return false;
  const left = e.trialEndsAt - now;
  return 0 < left && left <= TRIAL_WARN_MS;
}

/** Home: shown only when what this phone logs isn't reaching the family (or soon won't: the trial ends in 3 days). */
export function AccessBanner() {
  const access = useAccess();
  const entitlement = useAccessStore((s) => s.entitlement);
  const formatUntil = useFormatUntil();
  const now = useNow(MINUTE_MS); // "tomorrow" becomes "today" at midnight
  const trialEnding = access === 'trial' && trialEndsSoon(entitlement, now);
  if (access !== 'readOnly' && access !== 'grace' && !trialEnding) return null;
  const text = trialEnding
    ? t('access.bannerTrialEnds', { until: formatUntil(entitlement!.trialEndsAt!, now) })
    : access === 'readOnly'
      ? t('access.bannerReadOnly')
      : t(joinedAfterTrial(entitlement) ? 'access.bannerGraceLate' : 'access.bannerGrace', { until: formatUntil(entitlement?.graceEndsAt ?? now, now) });
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
  sandboxTitle: 'App Store sandbox', // i18n-ignore
  sandboxRefund: 'Request a refund of the unlock', // i18n-ignore
  sandboxHint: 'Apple decides the sandbox refund; the server should then lock this phone again.', // i18n-ignore
};

/** Dev builds and test-store servers: pretend to be in any state, and refund test purchases. */
export function AccessDevTools() {
  const show = useDevTools();
  const pretend = useAccessStore((s) => s.pretend);
  const testStore = useAccessStore((s) => s.testPurchases);
  const hasTest = useAccessStore((s) => s.testTokens.length > 0);
  const { busy, run } = useStoreAction();
  const sandbox = useSandboxUnlock();
  if (!show) return sandbox ? <SandboxRefund busy={busy} run={run} /> : null;
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
      {sandbox ? <SandboxRefund busy={busy} run={run} /> : null}
    </>
  );
}

/** iOS: whether this Apple account's unlock is a sandbox one (checked once per screen). */
function useSandboxUnlock() {
  const [sandbox, setSandbox] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    sandboxUnlock().then(
      (s) => live && setSandbox(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  return sandbox;
}

/**
 * Apple's refund sheet, only for a sandbox unlock (Xcode and TestFlight builds), to test that a refund reaches the
 * server. Real customers ask Apple or Google; the app has no refund button for them.
 */
function SandboxRefund({ busy, run }: ReturnType<typeof useStoreAction>) {
  return (
    <>
      <SectionLabel>{DEV.sandboxTitle}</SectionLabel>
      <Card>
        <Row label={DEV.sandboxRefund} onPress={busy ? undefined : () => void run(() => requestSandboxRefund())} />
      </Card>
      <Hint className="ml-1">{DEV.sandboxHint}</Hint>
    </>
  );
}
