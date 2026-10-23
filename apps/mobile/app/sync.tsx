import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { useActiveChild } from '../store/useActiveChild';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFormatTime, useNow } from '../store/timeHelpers';
import { setUpSync, syncNow, turnOffSync, useSyncStore } from '../features/sync/engine';
import { Button, Card, FieldLabel, Row, TextField } from '../components/ui';
import { colors } from '../theme/colors';

/** Sync between phones: set up (first phone), status, and turning it off. Pairing comes next. */
export default function SyncScreen() {
  const sync = useSettingsStore((s) => s.sync);
  return (
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {sync ? <Status /> : <SetUp />}
    </ScrollView>
  );
}

function SetUp() {
  const child = useActiveChild();
  const [server, setServer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await setUpSync(server);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text className="text-ink text-xl font-bold">Sync between phones</Text>
      <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
        Share {child?.name ?? 'your child'}'s log with a second phone. Everything is encrypted on this phone first; the server
        only ever sees scrambled data it can't read.
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
        <Text className="text-ink-faint text-xs mt-2 ml-1">Hosted Kindred Sync is coming. For now, use a server you run yourself.</Text>
      </View>

      {error ? <Text className="text-red-soft text-sm mt-4">{error}</Text> : null}
      <Button label={busy ? 'Setting up…' : 'Set up sync'} onPress={start} disabled={busy || !server.trim()} />
      <Text className="text-ink-faint text-xs text-center mt-3">This phone becomes the first phone in your family.</Text>
    </>
  );
}

function Status() {
  const sync = useSettingsStore((s) => s.sync)!;
  const { phase, error, pending, progress } = useSyncStore();
  const formatTime = useFormatTime();
  useNow(30_000);

  const state =
    phase === 'syncing'
      ? progress
        ? `${progress.label} · ${progress.done.toLocaleString()}`
        : 'Syncing…'
      : phase === 'error'
        ? "Couldn't sync"
        : pending
          ? `${pending.toLocaleString()} changes waiting`
          : 'Up to date';

  const confirmOff = () =>
    Alert.alert(
      'Turn off sync on this phone?',
      'Everything stays on this phone, but it stops syncing. Setting it up again starts a new family.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => turnOffSync() },
      ],
    );

  return (
    <>
      <Card>
        <Row
          label="Status"
          value={state}
          right={phase === 'syncing' ? <ActivityIndicator size="small" color={colors.violetStrong} /> : undefined}
        />
        <Row label="Last synced" value={sync.lastSyncedAt ? formatTime(sync.lastSyncedAt) : 'Not yet'} />
        <Row label="Server" value={sync.server.replace(/^https?:\/\//, '')} />
      </Card>
      {phase === 'error' && error ? <Text className="text-red-soft text-sm mt-3 ml-1">{error}</Text> : null}
      <Button label="Sync now" variant="ghost" onPress={() => syncNow().catch(() => {})} disabled={phase === 'syncing'} />

      <Text className="text-xs font-semibold text-ink-muted uppercase mt-8 mb-2 ml-1">Phones</Text>
      <Text className="text-ink-faint text-sm ml-1">Adding a second phone by QR code is coming in the next update.</Text>

      <Button label="Turn off sync on this phone" variant="danger" onPress={confirmOff} />
    </>
  );
}
