import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { newRecoveryWords, normalizeRecoveryWords } from '@subby/shared/crypto';
import { setRecoveryKey } from '../../features/sync/family';
import { useSyncStore } from '../../features/sync/engine';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Button, FieldLabel, TextField } from '../../components/ui';
import { SubLoader } from '../../components/brand/loaders';
import { ScreenScroll } from '../../components/ScreenScroll';

type Step = { kind: 'intro' } | { kind: 'words'; words: string[] } | { kind: 'check'; words: string[] } | { kind: 'saving' } | { kind: 'done' };

/**
 * Creates (or replaces) the family's recovery key. The words are registered with the server only after the
 * person has typed two of them back, so nobody ends up with a recovery key they never wrote down.
 */
export default function RecoveryKeyScreen() {
  const hasRecovery = useSyncStore((s) => s.hasRecovery);
  const [step, setStep] = useState<Step>({ kind: 'intro' });
  const [error, setError] = useState<string | null>(null);

  const save = async (words: string[]) => {
    setStep({ kind: 'saving' });
    setError(null);
    try {
      await setRecoveryKey(words.join(' '));
      setStep({ kind: 'done' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep({ kind: 'check', words });
    }
  };

  return (
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {step.kind === 'intro' ? (
        <>
          <Text className="text-ink text-xl font-bold">{hasRecovery ? 'Make a new recovery key' : 'A way back in if every phone is lost'}</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
            24 words that get your family's data back on a new phone if every phone in the family is lost. Write them on paper and keep
            them somewhere safe. Anyone with the words can read your family's data.
          </Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-3">
            Nobody else can recover your data, not even us: the server only stores data it can't read. If every phone is lost and there
            is no recovery key, the data is gone.
          </Text>
          {hasRecovery ? (
            <Text className="text-ink-soft text-[15px] leading-[22px] mt-3">
              Your family already has a recovery key. A new one replaces it, and the old words stop working.
            </Text>
          ) : null}
          <Button
            label={hasRecovery ? 'Make new words' : 'Show my recovery key'}
            onPress={() => setStep({ kind: 'words', words: newRecoveryWords().split(' ') })}
          />
        </>
      ) : null}

      {step.kind === 'words' ? (
        <>
          <Text className="text-ink text-xl font-bold">Write these words down</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
            In this order, on paper. Don't take a screenshot: photos often end up in the cloud.
          </Text>
          <Words words={step.words} />
          <ServerNote />
          <Button label="I've written them down" onPress={() => setStep({ kind: 'check', words: step.words })} />
        </>
      ) : null}

      {step.kind === 'check' ? <Check words={step.words} error={error} onBack={() => setStep({ kind: 'words', words: step.words })} onOk={save} /> : null}

      {step.kind === 'saving' ? (
        <View className="items-center mt-24">
          <SubLoader />
          <Text className="text-ink-muted mt-4">Saving the recovery key…</Text>
        </View>
      ) : null}

      {step.kind === 'done' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">Recovery key saved</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
            To use it on a new phone, choose "Join a family", then "Use a recovery key". Keep the paper safe; this app won't show the
            words again.
          </Text>
          <Button label="Done" onPress={() => router.back()} />
        </>
      ) : null}
    </ScreenScroll>
  );
}

function Words({ words }: { words: string[] }) {
  const half = Math.ceil(words.length / 2);
  const column = (start: number) => (
    <View className="flex-1">
      {words.slice(start, start + half).map((w, i) => (
        <View key={start + i} className="flex-row items-baseline py-1.5">
          <Text className="text-ink-faint text-sm w-7 text-right mr-3">{start + i + 1}</Text>
          <Text className="text-ink text-[17px] font-semibold">{w}</Text>
        </View>
      ))}
    </View>
  );
  return (
    <View className="flex-row bg-surface border border-line rounded-2xl px-3 py-3 mt-6">
      {column(0)}
      {column(half)}
    </View>
  );
}

function ServerNote() {
  const server = useSettingsStore((s) => s.sync?.server);
  if (!server) return null;
  return (
    <Text className="text-ink-soft text-sm leading-5 mt-4">
      Also note the sync server: <Text className="text-ink font-semibold">{server.replace(/^https?:\/\//, '')}</Text>
    </Text>
  );
}

/** Asks for two of the words back, to catch a skipped or misspelled word now rather than when it's needed. */
function Check({ words, error, onBack, onOk }: { words: string[]; error: string | null; onBack: () => void; onOk: (words: string[]) => void }) {
  const picks = useMemo(() => {
    const a = Math.floor(Math.random() * 12);
    return [a, 12 + Math.floor(Math.random() * 12)];
  }, []);
  const [answers, setAnswers] = useState(['', '']);
  const [wrong, setWrong] = useState(false);

  const check = () => {
    const ok = picks.every((n, i) => normalizeRecoveryWords(answers[i]!) === words[n]);
    setWrong(!ok);
    if (ok) onOk(words);
  };

  return (
    <>
      <Text className="text-ink text-xl font-bold">Check your paper</Text>
      <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">Type these two words from what you wrote down.</Text>
      {picks.map((n, i) => (
        <View key={n} className="mt-5">
          <FieldLabel>Word {n + 1}</FieldLabel>
          <TextField
            value={answers[i]}
            onChangeText={(t) => setAnswers((a) => a.map((v, j) => (j === i ? t : v)))}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
          />
        </View>
      ))}
      {wrong ? <Text className="text-red-soft text-sm mt-4">That doesn't match. Check the paper against the words.</Text> : null}
      {error ? <Text className="text-red-soft text-sm mt-4">{error}</Text> : null}
      <Button label="Save the recovery key" onPress={check} disabled={answers.some((a) => !a.trim())} />
      <Button label="Show the words again" variant="ghost" onPress={onBack} />
    </>
  );
}
