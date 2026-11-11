import { t } from '@subby/shared/i18n';
import { errorMessage } from '../../features/errorMessage';
import { useAsyncAction } from '../../features/useAsyncAction';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { isValidRecoveryWords, normalizeRecoveryWords } from '@subby/shared/crypto';
import { defaultDeviceName, hasLocalData, recoverFamily, removeDevices } from '../../features/sync/family';
import { syncNow } from '../../features/sync/engine';
import { useSyncStore } from '../../features/sync/state';
import { Button, FieldLabel, SECRET_INPUT, TextField, ErrorText, Lead, Hint, LoaderBlock, ScreenTitle } from '../../components/ui';
import { useServerChoice } from '../../components/ServerChoice';
import { FailedStep, ReplaceOrMerge, SyncBusy } from '../../components/SyncSteps';
import { ScreenScroll } from '../../components/ScreenScroll';
import { useSettingsStore } from '../../store/useSettingsStore';
import { colors } from '../../theme/colors';
import { Check } from '../../components/icons';

type Step = { kind: 'enter' } | { kind: 'choose' } | { kind: 'working' } | { kind: 'lost'; ids: string[] } | { kind: 'error'; message: string };

/** A new phone with only the recovery words: enter them and the server, and get the family's data back. */
export default function RecoverScreen() {
  const [step, setStep] = useState<Step>({ kind: 'enter' });
  const { server, ready, field, toggle } = useServerChoice();
  const [words, setWords] = useState('');
  const count = normalizeRecoveryWords(words).split(' ').filter(Boolean).length;
  const valid = count === 24 && isValidRecoveryWords(words);

  const start = async () => {
    if (await hasLocalData()) setStep({ kind: 'choose' });
    else void run('merge');
  };

  const run = async (local: 'merge' | 'replace') => {
    setStep({ kind: 'working' });
    try {
      await recoverFamily(server, words, local, defaultDeviceName());
    } catch (e) {
      setStep({ kind: 'error', message: errorMessage(e) });
      return;
    }
    // The phone is in the family now: a failed first sync is retried by the next one, never by recovering again
    // (that would add this phone a second time).
    await syncNow().catch(() => {});
    // Recovering means the other phones are gone; while they stay in the family they could read what comes next.
    const others = useSyncStore.getState().members.filter((m) => !m.isMe).map((m) => m.id);
    if (others.length) setStep({ kind: 'lost', ids: others });
    else router.replace('/');
  };

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
      {step.kind === 'enter' ? (
        <>
          <ScreenTitle>{t('recover.title')}</ScreenTitle>
          <Lead className="mt-2">
            {t('recover.lead')}
          </Lead>

          <View className="mt-6">
            <FieldLabel>{t('recover.words')}</FieldLabel>
            <TextField
              value={words}
              onChangeText={setWords}
              multiline
              {...SECRET_INPUT}
              style={{ minHeight: 120, textAlignVertical: 'top' }}
            />
            <Hint className="ml-1">
              {count === 24 && !valid ? t('recover.wrongWord') : t('recover.count', { count })}
            </Hint>
          </View>

          {field ? <View className="mt-3">{field}</View> : null}
          <Button label={t('recover.recover')} onPress={start} disabled={!valid || !ready} />
          {toggle}
        </>
      ) : null}

      {step.kind === 'choose' ? (
        <ReplaceOrMerge lead={t('recover.hasEntriesText')} onReplace={() => run('replace')} onMerge={() => run('merge')} />
      ) : null}

      {step.kind === 'working' ? <SyncBusy label={t('recover.recovering')} /> : null}

      {step.kind === 'lost' ? <LostPhones ids={step.ids} /> : null}

      {step.kind === 'error' ? (
        <FailedStep title={t('recover.failed')} message={step.message} retryLabel={t('common.retry')} onRetry={() => setStep({ kind: 'enter' })} />
      ) : null}
    </ScreenScroll>
  );
}

/** After a recovery: the family's other phones, all ticked for removal (untick one that's still in use). */
function LostPhones({ ids }: { ids: string[] }) {
  const names = useSettingsStore((s) => s.sync?.names ?? {});
  const [chosen, setChosen] = useState(() => new Set(ids));
  const { run, busy, error } = useAsyncAction();
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = () =>
    run(async () => {
      await removeDevices([...chosen]);
      router.replace('/');
    });

  if (busy) {
    return (
      <LoaderBlock label={t('recover.removing', { count: chosen.size })} />
    );
  }
  return (
    <>
      <ScreenTitle>{t('recover.back')}</ScreenTitle>
      <Lead className="mt-2">
        {t(ids.length === 1 ? 'recover.lostOne' : 'recover.lostMany')}
      </Lead>
      <View className="bg-surface rounded-2xl border border-line mt-4">
        {ids.map((id, i) => (
          <Pressable
            key={id}
            onPress={() => toggle(id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: chosen.has(id) }}
            className={`flex-row items-center px-4 py-3.5 ${i ? 'border-t border-line' : ''}`}
          >
            <Text className="flex-1 text-ink text-[15px]">{names[id] ?? t('syncScreen.phone')}</Text>
            <View className={`w-6 h-6 rounded-md items-center justify-center border ${chosen.has(id) ? 'bg-violet border-violet' : 'border-line'}`}>
              {chosen.has(id) ? <Check size={14} color={colors.ground} /> : null}
            </View>
          </Pressable>
        ))}
      </View>
      {error ? <ErrorText className="mt-3">{error}</ErrorText> : null}
      <Button
        label={chosen.size ? t('recover.removeN', { count: chosen.size }) : t('recover.removePhones')}
        onPress={remove}
        disabled={!chosen.size}
      />
      <Button label={t('recover.keep')} variant="ghost" onPress={() => router.replace('/')} />
      <Hint className="ml-1 text-center">{t('recover.later')}</Hint>
    </>
  );
}
