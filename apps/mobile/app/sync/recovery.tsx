import { t } from '@subby/shared/i18n';
import { errorMessage } from '../../features/errorMessage';
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { newRecoveryWords, normalizeRecoveryWords } from '@subby/shared/crypto';
import { setRecoveryKey } from '../../features/sync/family';
import { useSyncStore } from '../../features/sync/state';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Button, FieldLabel, SECRET_INPUT, TextField, ErrorText, Lead, Hint, ScreenTitle, LoaderBlock } from '../../components/ui';
import { ScreenScroll } from '../../components/ScreenScroll';
import { serverLabel } from '../../features/sync/api';

type Step = { kind: 'intro' } | { kind: 'words'; words: string[] } | { kind: 'check'; words: string[] } | { kind: 'saving' } | { kind: 'done' };

/**
 * Creates (or replaces) the family's recovery key. The words are registered with the server only after the
 * person has typed two of them back, so nobody ends up with a recovery key they never wrote down.
 */
export default function RecoveryKeyScreen() {
  const hasRecovery = useSyncStore((s) => s.hasRecovery);
  // Opened right after setting up sync: the same screen, framed as the last step, with a way to skip it.
  const afterSetup = useLocalSearchParams<{ after?: string }>().after === 'setup';
  const [step, setStep] = useState<Step>({ kind: 'intro' });
  const [error, setError] = useState<string | null>(null);

  const save = async (words: string[]) => {
    setStep({ kind: 'saving' });
    setError(null);
    try {
      await setRecoveryKey(words.join(' '));
      setStep({ kind: 'done' });
    } catch (e) {
      setError(errorMessage(e));
      setStep({ kind: 'check', words });
    }
  };

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
      {step.kind === 'intro' ? (
        <>
          {afterSetup ? <Text className="text-green-soft text-sm font-semibold mb-2">{t('recovery.syncOn')}</Text> : null}
          <ScreenTitle>{t(hasRecovery ? 'recovery.makeNew' : 'recovery.wayBack')}</ScreenTitle>
          <Lead className="mt-2">
            {t('recovery.lead')}
          </Lead>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-3">
            {t('recovery.nobodyElse')}
          </Text>
          {hasRecovery ? (
            <Text className="text-ink-soft text-[15px] leading-[22px] mt-3">
              {t('recovery.replaces')}
            </Text>
          ) : null}
          <Button
            label={t(hasRecovery ? 'recovery.makeWords' : 'recovery.show')}
            onPress={() => setStep({ kind: 'words', words: newRecoveryWords().split(' ') })}
          />
          {afterSetup ? (
            <>
              <Button label={t('common.later')} variant="ghost" onPress={() => router.back()} />
              <Hint className="ml-1 text-center">{t('recovery.later')}</Hint>
            </>
          ) : null}
        </>
      ) : null}

      {step.kind === 'words' ? (
        <>
          <ScreenTitle>{t('recovery.writeDown')}</ScreenTitle>
          <Lead className="mt-2">
            {t('recovery.inOrder')}
          </Lead>
          <Words words={step.words} />
          <ServerNote />
          <Button label={t('recovery.written')} onPress={() => setStep({ kind: 'check', words: step.words })} />
        </>
      ) : null}

      {step.kind === 'check' ? <Check words={step.words} error={error} onBack={() => setStep({ kind: 'words', words: step.words })} onOk={save} /> : null}

      {step.kind === 'saving' ? (
        <LoaderBlock label={t('recovery.saving')} />
      ) : null}

      {step.kind === 'done' ? (
        <>
          <ScreenTitle className="mt-4">{t('recovery.saved')}</ScreenTitle>
          <Lead className="mt-2">
            {t('recovery.savedText')}
          </Lead>
          <Button label={t('common.done')} onPress={() => router.back()} />
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
      {t('recovery.serverNote')}
      <Text className="text-ink font-semibold">{serverLabel(server)}</Text>
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
      <ScreenTitle>{t('recovery.check')}</ScreenTitle>
      <Lead className="mt-2">{t('recovery.checkText')}</Lead>
      {picks.map((n, i) => (
        <View key={n} className="mt-5">
          <FieldLabel>{t('recovery.word', { n: n + 1 })}</FieldLabel>
          <TextField
            value={answers[i]}
            onChangeText={(text) => setAnswers((a) => a.map((v, j) => (j === i ? text : v)))}
            {...SECRET_INPUT}
          />
        </View>
      ))}
      {wrong ? <ErrorText className="mt-4">{t('recovery.mismatch')}</ErrorText> : null}
      {error ? <ErrorText className="mt-4">{error}</ErrorText> : null}
      <Button label={t('recovery.saveKey')} onPress={check} disabled={answers.some((a) => !a.trim())} />
      <Button label={t('recovery.showAgain')} variant="ghost" onPress={onBack} />
    </>
  );
}
