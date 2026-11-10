import { formatNumber, t } from '@subby/shared/i18n';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import type { BackupContents, RestorePlan } from '@subby/shared/domain/backup';
import { pickBackup, previewRestore, restoreBackup, saveBackup, savesToDownloads, unlockBackup } from '../features/backup';
import { Button, FieldLabel, TextField, ErrorText, Lead } from '../components/ui';
import { formatDayInline, useFormatTime } from '../store/timeHelpers';
import { SubLoader, SubProgress } from '../components/brand/loaders';
import { ScreenScroll } from '../components/ScreenScroll';
import { useChildStore } from '../store/useChildStore';

const MIN_PASSPHRASE = 8;

// Lets React draw the busy screen first: making, reading and restoring a backup start with synchronous work
// (zip, SQLite transaction) that would otherwise hold the JS thread before the loader ever shows.
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

type Step =
  | { kind: 'home' }
  | { kind: 'locked'; bytes: Uint8Array; name: string }
  | { kind: 'preview'; contents: BackupContents; plan: RestorePlan; name: string }
  | { kind: 'done'; message: string };

/**
 * Backup and restore: everything on this phone (children, entries, photos) as one file, optionally encrypted
 * with a passphrase. Restoring merges by entry, newest edit wins, so it never overwrites newer data.
 */
export default function BackupScreen() {
  const [step, setStep] = useState<Step>({ kind: 'home' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Passphrase key derivation takes a moment on a phone; scrypt reports how far it is.
  const [progress, setProgress] = useState(0);
  // A fresh install (or a phone without children) has nothing to back up: only Restore is offered.
  const hasData = useChildStore((s) => s.children.length > 0);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setProgress(0);
    setError(null);
    setNotice(null);
    try {
      await nextFrame();
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const open = async (contents: BackupContents, name: string) =>
    setStep({ kind: 'preview', contents, plan: await previewRestore(contents), name });

  const choose = () =>
    run(t('backup.reading'), async () => {
      const picked = await pickBackup();
      if (!picked) return;
      if (picked.kind === 'locked') setStep({ kind: 'locked', bytes: picked.bytes, name: picked.name });
      else await open(picked.contents, picked.name);
    });

  return (
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {busy ? <Busy label={busy} progress={progress} /> : null}

      {!busy && step.kind === 'home' ? (
        <>
          {hasData ? (
            <>
              <BackUp run={run} onProgress={setProgress} onDone={setNotice} />
              {notice ? <Text className="text-green-soft text-sm mt-3">{notice}</Text> : null}
            </>
          ) : null}

          <Text className={`text-ink text-xl font-bold ${hasData ? 'mt-10' : ''}`}>{t('backup.restoreTitle')}</Text>
          <Lead className="mt-2">
            {hasData
              ? t('backup.restoreMerge')
              : t('backup.restoreFresh')}
          </Lead>
          <Button label={t('backup.choose')} variant={hasData ? 'ghost' : 'primary'} onPress={choose} />
          {error ? <ErrorText className="mt-3">{error}</ErrorText> : null}
        </>
      ) : null}

      {!busy && step.kind === 'locked' ? (
        <Unlock
          name={step.name}
          error={error}
          onCancel={() => {
            setError(null);
            setStep({ kind: 'home' });
          }}
          onUnlock={(passphrase) => run(t('backup.unlocking'), async () => open(await unlockBackup(step.bytes, passphrase, setProgress), step.name))}
        />
      ) : null}

      {!busy && step.kind === 'preview' ? (
        <Preview
          step={step}
          error={error}
          onCancel={() => setStep({ kind: 'home' })}
          onRestore={() =>
            run(t('backup.restoring'), async () => {
              const r = await restoreBackup(step.contents, step.plan);
              setStep({
                kind: 'done',
                message: restoredMessage(r),
              });
            })
          }
        />
      ) : null}

      {!busy && step.kind === 'done' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">{t('backup.complete')}</Text>
          <Lead className="mt-2">{step.message}</Lead>
          <Button label={t('common.done')} onPress={() => router.replace('/')} />
        </>
      ) : null}
    </ScreenScroll>
  );
}

const count = (n: number, what: 'children' | 'entries' | 'photos' | 'deletions' | 'items') => t(`count.${what}`, { count: n });

function restoredMessage(r: { children: number; logs: number; photos: number; deletions: number }) {
  const what = { children: count(r.children, 'children'), entries: count(r.logs, 'entries'), photos: count(r.photos, 'photos') };
  const text = t(r.photos ? 'backup.restoredPhotos' : 'backup.restored', what);
  return r.deletions ? t('backup.deletionsApplied', { text, deletions: count(r.deletions, 'deletions') }) : text;
}

function BackUp({
  run,
  onProgress,
  onDone,
}: {
  run: (label: string, work: () => Promise<void>) => Promise<void>;
  onProgress: (p: number) => void;
  onDone: (message: string) => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE;
  const mismatch = passphrase.length > 0 && confirm.length > 0 && confirm !== passphrase;
  const ready = passphrase.length === 0 || (!tooShort && confirm === passphrase);

  const backUp = () =>
    run(t(passphrase ? 'backup.encrypting' : 'backup.making'), async () => {
      const r = await saveBackup(passphrase || null, onProgress);
      const made = t('backup.made', { children: count(r.children, 'children'), entries: count(r.logs, 'entries'), photos: count(r.photos, 'photos') });
      onDone(r.savedAs ? t('backup.savedAs', { text: made, name: r.savedAs }) : made);
    });

  return (
    <>
      <Text className="text-ink text-xl font-bold">{t('backup.backUp')}</Text>
      <Lead className="mt-2">
        {t('backup.lead')}{' '}
        {t(savesToDownloads ? 'backup.whereDownloads' : 'backup.whereFiles')}
      </Lead>

      <FieldLabel>{t('backup.passphraseOptional')}</FieldLabel>
      <TextField value={passphrase} onChangeText={setPassphrase} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder={t('backup.encryptPlaceholder')} />
      {passphrase ? (
        <TextField
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('backup.again')}
          className="mt-2"
        />
      ) : null}
      <Text className={`text-xs mt-2 ml-1 leading-5 ${tooShort || mismatch ? 'text-red-soft' : 'text-ink-faint'}`}>
        {tooShort
          ? t('backup.tooShort', { count: MIN_PASSPHRASE })
          : mismatch
            ? t('backup.mismatch')
            : passphrase
              ? t('backup.forget')
              : t('backup.noPassphrase')}
      </Text>

      <Button label={t(savesToDownloads ? 'backup.saveDownloads' : 'backup.save')} onPress={backUp} disabled={!ready} />
    </>
  );
}

function Unlock({
  name,
  error,
  onCancel,
  onUnlock,
}: {
  name: string;
  error: string | null;
  onCancel: () => void;
  onUnlock: (passphrase: string) => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  return (
    <>
      <Text className="text-ink text-xl font-bold">{t('backup.encrypted')}</Text>
      <Lead className="mt-2">{name}</Lead>
      <FieldLabel>{t('backup.passphrase')}</FieldLabel>
      <TextField value={passphrase} onChangeText={setPassphrase} secureTextEntry autoCapitalize="none" autoCorrect={false} autoFocus />
      {error ? <ErrorText className="mt-3">{error}</ErrorText> : null}
      <Button label={t('backup.unlock')} onPress={() => onUnlock(passphrase)} disabled={!passphrase} />
      <Button label={t('common.cancel')} variant="ghost" onPress={onCancel} />
    </>
  );
}

function Preview({
  step,
  error,
  onCancel,
  onRestore,
}: {
  step: Extract<Step, { kind: 'preview' }>;
  error: string | null;
  onCancel: () => void;
  onRestore: () => void;
}) {
  const formatTime = useFormatTime();
  const { backup, photos, invalid } = step.contents;
  const { plan } = step;
  const changes = plan.children.length + plan.logs.length + plan.deletions.length;
  return (
    <>
      <Text className="text-ink text-xl font-bold">{t('backup.restoreThis')}</Text>
      <Lead className="mt-2">
        {t('backup.madeAt', {
          day: formatDayInline(backup.createdAt),
          time: formatTime(backup.createdAt),
          children: count(backup.children.length, 'children'),
          entries: count(backup.logs.length, 'entries'),
          photos: count(photos.size, 'photos'),
        })}
      </Lead>

      <View className="bg-surface rounded-2xl border border-line px-4 py-3 mt-4">
        <Line label={t('backup.addChildren')} value={plan.children.length} />
        <Line label={t('backup.addEntries')} value={plan.logs.length} />
        {plan.deletions.length ? <Line label={t('backup.deletions')} value={plan.deletions.length} /> : null}
        <Line label={t('backup.unchanged')} value={plan.unchanged} />
      </View>
      {invalid ? (
        <Text className="text-amber-soft text-xs mt-2 ml-1">{t('backup.invalid', { items: count(invalid, 'items') })}</Text>
      ) : null}
      {error ? <ErrorText className="mt-3">{error}</ErrorText> : null}

      {changes ? <Button label={t('backup.restore')} onPress={onRestore} /> : <Text className="text-ink-muted mt-4">{t('backup.nothingNew')}</Text>}
      <Button label={t(changes ? 'common.cancel' : 'common.back')} variant="ghost" onPress={onCancel} />
    </>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-row py-1">
      <Text className="flex-1 text-ink-soft">{label}</Text>
      <Text className="text-ink font-semibold">{formatNumber(value)}</Text>
    </View>
  );
}

function Busy({ label, progress }: { label: string; progress: number }) {
  return (
    <View className="items-center mt-24">
      {progress > 0 && progress < 1 ? <SubProgress progress={progress} /> : <SubLoader />}
      <Text className="text-ink-muted mt-4">{progress > 0 && progress < 1 ? t('backup.percent', { label, percent: Math.round(progress * 100) }) : label}</Text>
    </View>
  );
}
