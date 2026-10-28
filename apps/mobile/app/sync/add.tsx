import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Share, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import type { InviteResponse } from '@kindred-log/shared/sync';
import { approveClaim, claimCode, createInvite, inviteStatus, type Invite } from '../../features/sync/family';
import QrCode from '../../components/QrCode';
import { Button } from '../../components/ui';
import { useNow } from '../../store/timeHelpers';
import { PeriscopeLoader } from '../../components/brand/loaders';

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
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {step.kind === 'loading' || step.kind === 'approving' ? (
        <View className="items-center mt-24">
          <PeriscopeLoader />
          <Text className="text-ink-muted mt-4">{step.kind === 'approving' ? 'Adding the phone…' : 'Creating a code…'}</Text>
        </View>
      ) : null}

      {step.kind === 'showing' ? (
        <>
          <Text className="text-ink text-xl font-bold">Scan this on the other phone</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
            On the new phone, open Subby and choose "Join a family" (or Settings → Sync → Join), then scan this code.
          </Text>
          <View className="items-center mt-6">
            <View className="rounded-2xl overflow-hidden">
              <QrCode value={step.invite.code} size={size} />
            </View>
            <Text className="text-ink-muted text-sm mt-4">
              {now < step.invite.expiresAt
                ? `Works once, for ${Math.ceil((step.invite.expiresAt - now) / 60_000)} more min`
                : 'This code expired'}
            </Text>
          </View>
          {now >= step.invite.expiresAt ? <Button label="Make a new code" onPress={start} /> : null}
          <Button label="Send the code instead" variant="ghost" onPress={() => Share.share({ message: step.invite.code })} />
          <Text className="text-ink-faint text-xs text-center mt-2">For when the camera can't scan. Anyone with it can ask to join, but you still confirm below.</Text>
        </>
      ) : null}

      {step.kind === 'confirm' ? (
        <>
          <Text className="text-ink text-xl font-bold">Does the other phone show this code?</Text>
          <Text className="text-ink text-[44px] font-bold text-center tracking-[6px] mt-8">
            {step.code.slice(0, 3)} {step.code.slice(3)}
          </Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-6">
            Only add it if both phones show the same six digits. If they differ, someone else used the code: cancel.
          </Text>
          <Button label="Same code, add the phone" onPress={() => approve(step.claimant)} />
          <Button label="Different, cancel" variant="ghost" onPress={() => router.back()} />
        </>
      ) : null}

      {step.kind === 'done' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">Phone added</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">It's downloading everything now. New entries show up on both phones within seconds.</Text>
          <Button label="Done" onPress={() => router.back()} />
        </>
      ) : null}

      {step.kind === 'error' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">Something went wrong</Text>
          <Text className="text-red-soft text-sm mt-2">{step.message}</Text>
          {step.retry ? (
            <Button label="Try adding it again" onPress={() => approve(step.retry!)} />
          ) : (
            <Button label="Try again" onPress={start} />
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
