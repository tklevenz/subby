import { t } from '@subby/shared/i18n';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { isValidRecoveryWords, normalizeRecoveryWords } from '@subby/shared/crypto';
import { defaultDeviceName, hasLocalData, recoverFamily, removeDevices } from '../../features/sync/family';
import { syncNow, useSyncStore } from '../../features/sync/engine';
import { Button, FieldLabel, SECRET_INPUT, TextField, ErrorText, Lead } from '../../components/ui';
import { useServerChoice } from '../../components/ServerChoice';
import { SubLoader } from '../../components/brand/loaders';
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
    else run('merge');
  };

  const run = async (local: 'merge' | 'replace') => {
    setStep({ kind: 'working' });
    try {
      await recoverFamily(server, words, local, defaultDeviceName());
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
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
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {step.kind === 'enter' ? (
        <>
          <Text className="text-ink text-xl font-bold">{t('recover.title')}</Text>
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
            <Text className="text-ink-faint text-xs mt-2 ml-1">
              {count === 24 && !valid ? t('recover.wrongWord') : t('recover.count', { count })}
            </Text>
          </View>

          {field ? <View className="mt-3">{field}</View> : null}
          <Button label={t('recover.recover')} onPress={start} disabled={!valid || !ready} />
          {toggle}
        </>
      ) : null}

      {step.kind === 'choose' ? (
        <>
          <Text className="text-ink text-xl font-bold">{t('join.hasEntries')}</Text>
          <Lead className="mt-2">
            {t('recover.hasEntriesText')}
          </Lead>
          <Button label={t('join.replace')} onPress={() => run('replace')} />
          <Text className="text-ink-faint text-xs text-center mt-2">{t('join.replaceNote')}</Text>
          <Button label={t('join.merge')} variant="ghost" onPress={() => run('merge')} />
        </>
      ) : null}

      {step.kind === 'working' ? <Busy /> : null}

      {step.kind === 'lost' ? <LostPhones ids={step.ids} /> : null}

      {step.kind === 'error' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">{t('recover.failed')}</Text>
          <ErrorText className="mt-2">{step.message}</ErrorText>
          <Button label={t('common.retry')} onPress={() => setStep({ kind: 'enter' })} />
        </>
      ) : null}
    </ScreenScroll>
  );
}

function Busy() {
  const progress = useSyncStore((s) => s.progress);
  return (
    <View className="items-center mt-24">
      <SubLoader />
      <Text className="text-ink-muted mt-4">{progress ? t('syncScreen.progress', { label: progress.label, count: progress.done }) : t('recover.recovering')}</Text>
    </View>
  );
}

/** After a recovery: the family's other phones, all ticked for removal (untick one that's still in use). */
function LostPhones({ ids }: { ids: string[] }) {
  const names = useSettingsStore((s) => s.sync?.names ?? {});
  const [chosen, setChosen] = useState(() => new Set(ids));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeDevices([...chosen]);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (busy) {
    return (
      <View className="items-center mt-24">
        <SubLoader />
        <Text className="text-ink-muted mt-4">{t('recover.removing', { count: chosen.size })}</Text>
      </View>
    );
  }
  return (
    <>
      <Text className="text-ink text-xl font-bold">{t('recover.back')}</Text>
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
      <Text className="text-ink-faint text-xs mt-2 ml-1 text-center">{t('recover.later')}</Text>
    </>
  );
}
