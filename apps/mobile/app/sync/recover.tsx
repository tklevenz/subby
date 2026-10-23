import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { isValidRecoveryWords, normalizeRecoveryWords } from '@kindred-log/shared/crypto';
import { defaultDeviceName, hasLocalData, recoverFamily } from '../../features/sync/family';
import { syncNow, useSyncStore } from '../../features/sync/engine';
import { Button, FieldLabel, TextField } from '../../components/ui';
import { colors } from '../../theme/colors';

type Step = { kind: 'enter' } | { kind: 'choose' } | { kind: 'working' } | { kind: 'error'; message: string };

/** A new phone with only the recovery words: enter them and the server, and get the family's data back. */
export default function RecoverScreen() {
  const [step, setStep] = useState<Step>({ kind: 'enter' });
  const [server, setServer] = useState('');
  const [words, setWords] = useState('');
  const count = normalizeRecoveryWords(words).split(' ').filter(Boolean).length;
  const valid = count === 24 && isValidRecoveryWords(words);

  const start = async () => {
    if (await hasLocalData()) setStep({ kind: 'choose' });
    else run('merge');
  };

  const run = async (local: 'merge' | 'replace') => {
    setStep({ kind: 'working' });
    try {
      await recoverFamily(server, words, local, defaultDeviceName());
      await syncNow();
      router.replace('/');
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {step.kind === 'enter' ? (
        <>
          <Text className="text-ink text-xl font-bold">Use a recovery key</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
            For when no phone in the family is left. If another phone still syncs, join with a code from it instead.
          </Text>

          <View className="mt-6">
            <FieldLabel>Sync server</FieldLabel>
            <TextField
              value={server}
              onChangeText={setServer}
              placeholder="https://sync.example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View className="mt-5">
            <FieldLabel>The 24 words, in order</FieldLabel>
            <TextField
              value={words}
              onChangeText={setWords}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              style={{ minHeight: 120, textAlignVertical: 'top' }}
            />
            <Text className="text-ink-faint text-xs mt-2 ml-1">
              {count === 24 && !valid ? "One of the words isn't right. Check the spelling and order." : `${count} of 24 words`}
            </Text>
          </View>

          <Button label="Recover" onPress={start} disabled={!valid || !server.trim()} />
        </>
      ) : null}

      {step.kind === 'choose' ? (
        <>
          <Text className="text-ink text-xl font-bold">This phone already has entries</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
            Add them to the family, or replace them with the family's data. If they came from the same Baby Buddy import, replace, or every
            entry shows up twice.
          </Text>
          <Button label="Replace with the family's data" onPress={() => run('replace')} />
          <Text className="text-ink-faint text-xs text-center mt-2">Deletes this phone's own entries and photos.</Text>
          <Button label="Add my entries to the family" variant="ghost" onPress={() => run('merge')} />
        </>
      ) : null}

      {step.kind === 'working' ? <Busy /> : null}

      {step.kind === 'error' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">Couldn't recover</Text>
          <Text className="text-red-soft text-sm mt-2">{step.message}</Text>
          <Button label="Try again" onPress={() => setStep({ kind: 'enter' })} />
        </>
      ) : null}
    </ScrollView>
  );
}

function Busy() {
  const progress = useSyncStore((s) => s.progress);
  return (
    <View className="items-center mt-24">
      <ActivityIndicator size="large" color={colors.violetStrong} />
      <Text className="text-ink-muted mt-4">{progress ? `${progress.label} · ${progress.done.toLocaleString()}` : 'Recovering…'}</Text>
    </View>
  );
}
