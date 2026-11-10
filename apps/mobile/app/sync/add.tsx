import { t } from '@subby/shared/i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Share, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import type { InviteResponse } from '@subby/shared/sync';
import { approveClaim, claimCode, createInvite, inviteStatus, type Invite } from '../../features/sync/family';
import QrCode from '../../components/QrCode';
import { Button, ErrorText, Lead } from '../../components/ui';
import { useNow } from '../../store/timeHelpers';
import { PeriscopeLoader } from '../../components/brand/loaders';
import { ScreenScroll } from '../../components/ScreenScroll';

type Claimant = NonNullable<InviteResponse['claimant']>;
type Step =
  | { kind: 'loading' }
  | { kind: 'showing'; invite: Invite }
  | { kind: 'confirm'; invite: Invite; claimant: Claimant; code: string }
  | { kind: 'approving' }
  | { kind: 'done' }
  /** `retry`: the approval failed partway; trying again finishes it for the same phone (a new code would orphan it). */
  | { kind: 'error'; message: string; retry?: Claimant };

const POLL_MS = 2000;

/** The phone already in the family: shows a one-time QR code, then the code to compare, then adds the phone. */
export default function AddPhoneScreen() {
  const { width } = useWindowDimensions();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const now = useNow(1000);
  const active = useRef(true);

  const start = useCallback(() => {
    setStep({ kind: 'loading' });
    createInvite()
      .then((invite) => setStep({ kind: 'showing', invite }))
      .catch((e: unknown) => setStep({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
  }, []);

  useEffect(() => {
    start();
    return () => {
      active.current = false;
    };
  }, [start]);

  // Wait for the new phone to scan the code and send its keys.
  useEffect(() => {
    if (step.kind !== 'showing') return;
    const timer = setInterval(async () => {
      try {
        const res = await inviteStatus(step.invite.inviteId);
        if (!active.current || res.status !== 'claimed' || !res.claimant) return;
        clearInterval(timer);
        setStep({ kind: 'confirm', invite: step.invite, claimant: res.claimant, code: claimCode(step.invite, res.claimant) });
      } catch (e) {
        clearInterval(timer);
        setStep({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [step]);

  const approve = async (claimant: Claimant) => {
    setStep({ kind: 'approving' });
    try {
      await approveClaim(claimant);
      setStep({ kind: 'done' });
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : String(e), retry: claimant });
    }
  };

  const size = Math.min(width - 64, 320);

  return (
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {step.kind === 'loading' || step.kind === 'approving' ? (
        <View className="items-center mt-24">
          <PeriscopeLoader />
          <Text className="text-ink-muted mt-4">{t(step.kind === 'approving' ? 'add.adding' : 'add.creating')}</Text>
        </View>
      ) : null}

      {step.kind === 'showing' ? (
        <>
          <Text className="text-ink text-xl font-bold">{t('add.scanThis')}</Text>
          <Lead className="mt-2">
            {t('add.howTo')}
          </Lead>
          <View className="items-center mt-6">
            <View className="rounded-2xl overflow-hidden">
              <QrCode value={step.invite.code} size={size} />
            </View>
            <Text className="text-ink-muted text-sm mt-4">
              {now < step.invite.expiresAt
                ? t('add.worksFor', { count: Math.ceil((step.invite.expiresAt - now) / 60_000) })
                : t('add.expired')}
            </Text>
          </View>
          {now >= step.invite.expiresAt ? <Button label={t('add.newCode')} onPress={start} /> : null}
          <Button label={t('add.send')} variant="ghost" onPress={() => Share.share({ message: step.invite.code })} />
          <Text className="text-ink-faint text-xs text-center mt-2">{t('add.sendNote')}</Text>
        </>
      ) : null}

      {step.kind === 'confirm' ? (
        <>
          <Text className="text-ink text-xl font-bold">{t('add.sameCode')}</Text>
          <Text className="text-ink text-[44px] font-bold text-center tracking-[6px] mt-8">
            {step.code.slice(0, 3)} {step.code.slice(3)}
          </Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-6">
            {t('add.onlyIfSame')}
          </Text>
          <Button label={t('add.approve')} onPress={() => approve(step.claimant)} />
          <Button label={t('add.different')} variant="ghost" onPress={() => router.back()} />
        </>
      ) : null}

      {step.kind === 'done' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">{t('add.added')}</Text>
          <Lead className="mt-2">{t('add.addedText')}</Lead>
          <Button label={t('common.done')} onPress={() => router.back()} />
        </>
      ) : null}

      {step.kind === 'error' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">{t('add.wrong')}</Text>
          <ErrorText className="mt-2">{step.message}</ErrorText>
          {step.retry ? (
            <Button label={t('add.retryAdd')} onPress={() => approve(step.retry!)} />
          ) : (
            <Button label={t('common.retry')} onPress={start} />
          )}
        </>
      ) : null}
    </ScreenScroll>
  );
}
