import { t } from '@subby/shared/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { claimInvite, defaultDeviceName, finishJoin, hasLocalData, joinStatus, type Join } from '../../features/sync/family';
import { syncNow, useSyncStore } from '../../features/sync/engine';
import { Button, FieldLabel, TextField, ErrorText, Lead, SectionLabel } from '../../components/ui';
import { PeriscopeLoader, SubLoader } from '../../components/brand/loaders';
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
  const fail = (e: unknown) => setStep({ kind: 'error', message: e instanceof Error ? e.message : String(e) });

  const claim = async (text: string) => {
    setStep({ kind: 'claiming' });
    try {
      setStep({ kind: 'waiting', join: await claimInvite(text) });
    } catch (e) {
      fail(e);
    }
  };

  // Wait for the other phone to confirm the code.
  useEffect(() => {
    if (step.kind !== 'waiting') return;
    const timer = setInterval(async () => {
      try {
        const status = await joinStatus(step.join);
        if (status === 'approved') {
          clearInterval(timer);
          if (await hasLocalData()) setStep({ kind: 'choose', join: step.join });
          else finish(step.join, 'merge');
        } else if (status === 'expired') {
          clearInterval(timer);
          fail(new Error(t('join.expired')));
        }
      } catch (e) {
        clearInterval(timer);
        fail(e);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [step]);

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
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {step.kind === 'scan' ? <Scan onCode={claim} /> : null}

      {step.kind === 'claiming' || step.kind === 'finishing' ? <Busy label={t(step.kind === 'claiming' ? 'join.checking' : 'join.joining')} /> : null}

      {step.kind === 'waiting' ? (
        <>
          <Text className="text-ink text-xl font-bold">{t('join.confirmThere')}</Text>
          <Lead className="mt-2">{t('join.confirmText')}</Lead>
          <Text className="text-ink text-[44px] font-bold text-center tracking-[6px] mt-10">
            {step.join.code.slice(0, 3)} {step.join.code.slice(3)}
          </Text>
          <View className="items-center mt-10">
            <PeriscopeLoader width={72} />
            <Text className="text-ink-muted mt-3">{t('join.waiting')}</Text>
          </View>
        </>
      ) : null}

      {step.kind === 'choose' ? (
        <>
          <Text className="text-ink text-xl font-bold">{t('join.hasEntries')}</Text>
          <Lead className="mt-2">
            {t('join.hasEntriesText')}
          </Lead>
          <Button label={t('join.replace')} onPress={() => finish(step.join, 'replace')} />
          <Text className="text-ink-faint text-xs text-center mt-2">{t('join.replaceNote')}</Text>
          <Button label={t('join.merge')} variant="ghost" onPress={() => finish(step.join, 'merge')} />
        </>
      ) : null}

      {step.kind === 'error' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">{t('join.failed')}</Text>
          <ErrorText className="mt-2">{step.message}</ErrorText>
          <Button label={t('join.scanNew')} onPress={() => setStep({ kind: 'scan' })} />
        </>
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

function Busy({ label }: { label: string }) {
  const progress = useSyncStore((s) => s.progress);
  return (
    <View className="items-center mt-24">
      <SubLoader />
      <Text className="text-ink-muted mt-4">{progress ? t('syncScreen.progress', { label: progress.label, count: progress.done }) : label}</Text>
    </View>
  );
}
