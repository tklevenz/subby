import { t } from '@subby/shared/i18n';
import { errorMessage } from '../../features/errorMessage';
import React, { useRef, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { claimInvite, defaultDeviceName, finishJoin, hasLocalData, joinStatus, type Join } from '../../features/sync/family';
import { syncNow } from '../../features/sync/engine';
import { Button, FieldLabel, TextField, Lead, LoaderBlock, SectionLabel, ScreenTitle } from '../../components/ui';
import { PeriscopeLoader } from '../../components/brand/loaders';
import { FailedStep, ReplaceOrMerge, SyncBusy } from '../../components/SyncSteps';
import { usePoll } from '../../features/usePoll';
import { ScreenScroll } from '../../components/ScreenScroll';

type Step =
  | { kind: 'scan' }
  | { kind: 'claiming' }
  | { kind: 'waiting'; join: Join }
  | { kind: 'choose'; join: Join }
  | { kind: 'finishing' }
  | { kind: 'error'; message: string };

const POLL_MS = 2000;

/** The new phone: scan (or paste) the code from a phone in the family, compare codes, then download. */
export default function JoinScreen() {
  const [step, setStep] = useState<Step>({ kind: 'scan' });
  const fail = (e: unknown) => setStep({ kind: 'error', message: errorMessage(e) });

  const claim = async (text: string) => {
    setStep({ kind: 'claiming' });
    try {
      setStep({ kind: 'waiting', join: await claimInvite(text) });
    } catch (e) {
      fail(e);
    }
  };

  // Wait for the other phone to confirm the code.
  const waiting = step.kind === 'waiting' ? step.join : null;
  usePoll(
    waiting !== null,
    POLL_MS,
    async () => {
      if (!waiting) return true;
      const status = await joinStatus(waiting);
      if (status === 'approved') {
        if (await hasLocalData()) setStep({ kind: 'choose', join: waiting });
        else void finish(waiting, 'merge');
        return true;
      }
      if (status === 'expired') {
        fail(new Error(t('join.expired')));
        return true;
      }
    },
    fail,
    waiting,
  );

  const finish = async (join: Join, local: 'merge' | 'replace') => {
    setStep({ kind: 'finishing' });
    try {
      await finishJoin(join, local, defaultDeviceName());
    } catch (e) {
      fail(e);
      return;
    }
    // Download everything before leaving, so a phone joining from onboarding lands on Home with the family's data.
    // The phone is in the family now: a failed first sync is retried by the next one, never by joining again.
    await syncNow().catch(() => {});
    router.replace('/');
  };

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
      {step.kind === 'scan' ? <Scan onCode={claim} /> : null}

      {step.kind === 'claiming' || step.kind === 'finishing' ? <SyncBusy label={t(step.kind === 'claiming' ? 'join.checking' : 'join.joining')} /> : null}

      {step.kind === 'waiting' ? (
        <>
          <ScreenTitle>{t('join.confirmThere')}</ScreenTitle>
          <Lead className="mt-2">{t('join.confirmText')}</Lead>
          <Text className="text-ink text-[44px] font-bold text-center tracking-[6px] mt-10">
            {step.join.code.slice(0, 3)} {step.join.code.slice(3)}
          </Text>
          <LoaderBlock className="mt-10" loader={<PeriscopeLoader width={72} />} label={t('join.waiting')} />
        </>
      ) : null}

      {step.kind === 'choose' ? (
        <ReplaceOrMerge lead={t('join.hasEntriesText')} onReplace={() => finish(step.join, 'replace')} onMerge={() => finish(step.join, 'merge')} />
      ) : null}

      {step.kind === 'error' ? (
        <FailedStep title={t('join.failed')} message={step.message} retryLabel={t('join.scanNew')} onRetry={() => setStep({ kind: 'scan' })} />
      ) : null}
    </ScreenScroll>
  );
}

function Scan({ onCode }: { onCode: (text: string) => void }) {
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [pasted, setPasted] = useState('');
  const scanned = useRef(false);
  const size = Math.min(width - 32, 360);

  return (
    <>
      <Lead>
        {t('join.howTo')}
      </Lead>

      <View style={{ width: size, height: size }} className="self-center rounded-2xl overflow-hidden bg-raised mt-6 items-center justify-center">
        {permission?.granted ? (
          <CameraView
            style={{ width: size, height: size }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current || !data.startsWith('subby:')) return;
              scanned.current = true;
              onCode(data);
            }}
          />
        ) : (
          <View className="w-full px-6">
            <Text className="text-ink-soft text-center">{t('join.cameraOnly')}</Text>
            <Button label={t('join.allowCamera')} onPress={requestPermission} />
          </View>
        )}
      </View>

      <View className="mt-8">
        <FieldLabel>{t('join.paste')}</FieldLabel>
        <TextField value={pasted} onChangeText={setPasted} placeholder="subby:…" autoCapitalize="none" autoCorrect={false} />
        <Button label={t('join.useCode')} variant="ghost" onPress={() => onCode(pasted)} disabled={!pasted.trim()} />
      </View>

      <SectionLabel>{t('join.noPhoneLeft')}</SectionLabel>
      <Button label={t('join.useRecovery')} variant="ghost" onPress={() => router.push('/sync/recover')} />
    </>
  );
}
