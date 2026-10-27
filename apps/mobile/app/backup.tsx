import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { BackupContents, RestorePlan } from '@kindred-log/shared/domain/backup';
import { pickBackup, previewRestore, restoreBackup, saveBackup, savesToDownloads, unlockBackup } from '../features/backup';
import { Button, FieldLabel, TextField } from '../components/ui';
import { formatDayLabel, useFormatTime } from '../store/timeHelpers';
import { colors } from '../theme/colors';

const MIN_PASSPHRASE = 8;

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

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setProgress(0);
    setError(null);
    setNotice(null);
    try {
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
    run('Reading the backup…', async () => {
      const picked = await pickBackup();
      if (!picked) return;
      if (picked.kind === 'locked') setStep({ kind: 'locked', bytes: picked.bytes, name: picked.name });
      else await open(picked.contents, picked.name);
    });

  return (
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {busy ? <Busy label={busy} progress={progress} /> : null}

      {!busy && step.kind === 'home' ? (
        <>
          <BackUp run={run} onProgress={setProgress} onDone={setNotice} />
          {notice ? <Text className="text-green-soft text-sm mt-3">{notice}</Text> : null}

          <Text className="text-ink text-xl font-bold mt-10">Restore</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
            Adds a backup's children, entries and photos to this phone. Where both have the same entry, the newer edit wins, so nothing newer
            is overwritten. Restoring the same file twice changes nothing.
          </Text>
          <Button label="Choose a backup file" variant="ghost" onPress={choose} />
          {error ? <Text className="text-red-soft text-sm mt-3">{error}</Text> : null}
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
          onUnlock={(passphrase) => run('Unlocking…', async () => open(await unlockBackup(step.bytes, passphrase, setProgress), step.name))}
        />
      ) : null}

      {!busy && step.kind === 'preview' ? (
        <Preview
          step={step}
          error={error}
          onCancel={() => setStep({ kind: 'home' })}
          onRestore={() =>
            run('Restoring…', async () => {
              const r = await restoreBackup(step.contents, step.plan);
              setStep({
                kind: 'done',
                message: `Restored ${count(r.children, 'child', 'children')} and ${count(r.logs, 'entry', 'entries')}` +
                  (r.photos ? `, with ${count(r.photos, 'photo', 'photos')}` : '') +
                  (r.deletions ? `. ${count(r.deletions, 'deletion', 'deletions')} applied.` : '.'),
              });
            })
          }
        />
      ) : null}

      {!busy && step.kind === 'done' ? (
        <>
          <Text className="text-ink text-xl font-bold mt-4">Restore complete</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">{step.message}</Text>
          <Button label="Done" onPress={() => router.replace('/')} />
        </>
      ) : null}
    </ScrollView>
  );
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

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
    run(passphrase ? 'Encrypting the backup…' : 'Making the backup…', async () => {
      const r = await saveBackup(passphrase || null, onProgress);
      const where = r.savedAs ? ` Saved in Downloads as ${r.savedAs}.` : '';
      onDone(`Backup made: ${count(r.children, 'child', 'children')}, ${count(r.logs, 'entry', 'entries')}, ${count(r.photos, 'photo', 'photos')}.${where}`);
    });

  return (
    <>
      <Text className="text-ink text-xl font-bold">Back up</Text>
      <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
        One file with every child, entry and photo on this phone.{' '}
        {savesToDownloads ? 'It goes to Downloads; copy it somewhere safe, like a computer or cloud storage.' : 'Save it to Files, a computer or cloud storage.'}
      </Text>

      <FieldLabel>Passphrase (optional)</FieldLabel>
      <TextField value={passphrase} onChangeText={setPassphrase} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Encrypt the file" />
      {passphrase ? (
        <TextField
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Type it again"
          className="mt-2"
        />
      ) : null}
      <Text className={`text-xs mt-2 ml-1 leading-5 ${tooShort || mismatch ? 'text-red-soft' : 'text-ink-faint'}`}>
        {tooShort
          ? `Use at least ${MIN_PASSPHRASE} characters.`
          : mismatch
            ? "The passphrases don't match."
            : passphrase
              ? "If you forget the passphrase, the backup can't be opened. Nobody can recover it."
              : 'Without a passphrase, anyone with the file can read everything in it, photos included.'}
      </Text>

      <Button label={savesToDownloads ? 'Save to Downloads' : 'Save backup…'} onPress={backUp} disabled={!ready} />
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
      <Text className="text-ink text-xl font-bold">This backup is encrypted</Text>
      <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">{name}</Text>
      <FieldLabel>Passphrase</FieldLabel>
      <TextField value={passphrase} onChangeText={setPassphrase} secureTextEntry autoCapitalize="none" autoCorrect={false} autoFocus />
      {error ? <Text className="text-red-soft text-sm mt-3">{error}</Text> : null}
      <Button label="Unlock" onPress={() => onUnlock(passphrase)} disabled={!passphrase} />
      <Button label="Cancel" variant="ghost" onPress={onCancel} />
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
      <Text className="text-ink text-xl font-bold">Restore this backup?</Text>
      <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
        Made {formatDayLabel(backup.createdAt).toLowerCase()} at {formatTime(backup.createdAt)}: {count(backup.children.length, 'child', 'children')},{' '}
        {count(backup.logs.length, 'entry', 'entries')}, {count(photos.size, 'photo', 'photos')}.
      </Text>

      <View className="bg-surface rounded-2xl border border-line px-4 py-3 mt-4">
        <Line label="Children to add or update" value={plan.children.length} />
        <Line label="Entries to add or update" value={plan.logs.length} />
        {plan.deletions.length ? <Line label="Deleted since, to delete here" value={plan.deletions.length} /> : null}
        <Line label="Already up to date" value={plan.unchanged} />
      </View>
      {invalid ? (
        <Text className="text-amber-soft text-xs mt-2 ml-1">{count(invalid, 'item', 'items')} in the file couldn't be read and will be skipped.</Text>
      ) : null}
      {error ? <Text className="text-red-soft text-sm mt-3">{error}</Text> : null}

      {changes ? <Button label="Restore" onPress={onRestore} /> : <Text className="text-ink-muted mt-4">This phone already has everything in this backup.</Text>}
      <Button label={changes ? 'Cancel' : 'Back'} variant="ghost" onPress={onCancel} />
    </>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-row py-1">
      <Text className="flex-1 text-ink-soft">{label}</Text>
      <Text className="text-ink font-semibold">{value.toLocaleString()}</Text>
    </View>
  );
}

function Busy({ label, progress }: { label: string; progress: number }) {
  return (
    <View className="items-center mt-24">
      <ActivityIndicator size="large" color={colors.violetStrong} />
      <Text className="text-ink-muted mt-4">{progress > 0 && progress < 1 ? `${label} ${Math.round(progress * 100)}%` : label}</Text>
    </View>
  );
}
