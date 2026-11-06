import React, { useEffect, useRef, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { claimInvite, defaultDeviceName, finishJoin, hasLocalData, joinStatus, type Join } from '../../features/sync/family';
import { syncNow, useSyncStore } from '../../features/sync/engine';
import { Button, FieldLabel, TextField } from '../../components/ui';
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
          fail(new Error('The code expired before the other phone confirmed. Make a new one there.'));
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
      // Download everything before leaving, so a phone joining from onboarding lands on Home with the family's data.
      await syncNow();
      router.replace('/');
    } catch (e) {
      fail(e);
    }
  };

  return (
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {step.kind === 'scan' ? <Scan onCode={claim} /> : null}

      {step.kind === 'claiming' || step.kind === 'finishing' ? <Busy label={step.kind === 'claiming' ? 'Checking the code…' : 'Joining…'} /> : null}

      {step.kind === 'waiting' ? (
        <>
          <Text className="text-ink text-xl font-bold">Confirm on the other phone</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">The other phone now shows a code too. Check it's the same and confirm there.</Text>
          <Text className="text-ink text-[44px] font-bold text-center tracking-[6px] mt-10">
            {step.join.code.slice(0, 3)} {step.join.code.slice(3)}
          </Text>
          <View className="items-center mt-10">
            <PeriscopeLoader width={72} />
            <Text className="text-ink-muted mt-3">Waiting for the other phone…</Text>
          </View>
        </>
      ) : null}

      {step.kind === 'choose' ? (
        <>
          <Text className="text-ink text-xl font-bold">This phone already has entries</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
            Add them to the family, or replace them with the family's data. If both phones imported the same Baby Buddy data, replace,
            or every entry shows up twice.
          </Text>
          <Button label="Replace with the family's data" onPress={() => finish(step.join, 'replace')} />
          <Text className="text-ink-faint text-xs text-center mt-2">Deletes this phone's own entries and photos.</Text>
          <Button label="Add my entries to the family" variant="ghost" onPress={() => finish(step.join, 'merge')} />
        </>
      ) : null}

      {step.kind === 'error' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">Couldn't join</Text>
          <Text className="text-red-soft text-sm mt-2">{step.message}</Text>
          <Button label="Scan a new code" onPress={() => setStep({ kind: 'scan' })} />
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
      <Text className="text-ink text-xl font-bold">Join a family</Text>
      <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
        On a phone that already syncs, open Settings → Sync → Add a phone, and scan the code it shows.
      </Text>

      <View style={{ width: size, height: size }} className="self-center rounded-2xl overflow-hidden bg-raised mt-6 items-center justify-center">
        {permission?.granted ? (
          <CameraView
            style={{ width: size, height: size }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current || !data.startsWith('kindred:')) return;
              scanned.current = true;
              onCode(data);
            }}
          />
        ) : (
          <View className="w-full px-6">
            <Text className="text-ink-soft text-center">The camera is only used to read the code.</Text>
            <Button label="Allow camera" onPress={requestPermission} />
          </View>
        )}
      </View>

      <View className="mt-8">
        <FieldLabel>Or paste the code</FieldLabel>
        <TextField value={pasted} onChangeText={setPasted} placeholder="kindred:…" autoCapitalize="none" autoCorrect={false} />
        <Button label="Use this code" variant="ghost" onPress={() => onCode(pasted)} disabled={!pasted.trim()} />
      </View>

      <Text className="text-xs font-semibold text-ink-muted uppercase mt-10 mb-2 ml-1">No phone in the family left?</Text>
      <Button label="Use a recovery key" variant="ghost" onPress={() => router.push('/sync/recover')} />
    </>
  );
}

function Busy({ label }: { label: string }) {
  const progress = useSyncStore((s) => s.progress);
  return (
    <View className="items-center mt-24">
      <SubLoader />
      <Text className="text-ink-muted mt-4">{progress ? `${progress.label} · ${progress.done.toLocaleString()}` : label}</Text>
    </View>
  );
}
