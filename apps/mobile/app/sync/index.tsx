import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useActiveChild } from '../../store/useActiveChild';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useFormatTime, useNow } from '../../store/timeHelpers';
import { pushDeviceName, setUpSync, syncNow, turnOffSync, useSyncStore } from '../../features/sync/engine';
import { defaultDeviceName, removeDevice } from '../../features/sync/family';
import { Button, Card, FieldLabel, Row, TextField } from '../../components/ui';
import { colors } from '../../theme/colors';

/** Sync between phones: set up or join, status, the family's phones, turning it off. */
export default function SyncScreen() {
  const sync = useSettingsStore((s) => s.sync);
  return (
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
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
      await setUpSync(server, defaultDeviceName());
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

      <Text className="text-xs font-semibold text-ink-muted uppercase mt-6 mb-2 ml-1">Another phone already syncs?</Text>
      <Button label="Join with a code from that phone" variant="ghost" onPress={() => router.push('/sync/join')} />

      <Text className="text-xs font-semibold text-ink-muted uppercase mt-8 mb-2 ml-1">Or start with this phone</Text>
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

      {error ? <Text className="text-red-soft text-sm mt-4">{error}</Text> : null}
      <Button label={busy ? 'Setting up…' : 'Set up sync'} onPress={start} disabled={busy || !server.trim()} />
      <Text className="text-ink-faint text-xs text-center mt-3">This phone becomes the first phone in your family.</Text>
    </>
  );
}

function Status() {
  const sync = useSettingsStore((s) => s.sync)!;
  const { phase, error, pending, progress, removed } = useSyncStore();
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
      'Everything stays on this phone, but it leaves the family and stops syncing. Joining again needs a new code from another phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => turnOffSync() },
      ],
    );

  if (removed) {
    return (
      <>
        <Text className="text-ink text-xl font-bold">This phone was removed from the family</Text>
        <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
          Another phone in the family removed it, so it no longer syncs. Everything already on this phone stays here. To sync again,
          turn sync off, then join with a new code from a phone in the family.
        </Text>
        <Button label="Turn off sync on this phone" onPress={() => turnOffSync()} />
      </>
    );
  }

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

      <Phones />

      <Button label="Turn off sync on this phone" variant="danger" onPress={confirmOff} />
    </>
  );
}

function Phones() {
  const sync = useSettingsStore((s) => s.sync)!;
  const members = useSyncStore((s) => s.members);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const nameOf = (id: string) => sync.names?.[id] ?? 'Phone';

  const rename = async () => {
    setEditing(false);
    if (name.trim() && name.trim() !== nameOf(sync.deviceId)) {
      await pushDeviceName(name.trim()).catch((e: unknown) => Alert.alert("Couldn't rename", e instanceof Error ? e.message : String(e)));
    }
  };

  const confirmRemove = (id: string) =>
    Alert.alert(
      `Remove ${nameOf(id)}?`,
      "It stops syncing and can't read anything added from now on. It keeps what it already has. Use this for a lost phone too.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            removeDevice(id).catch((e: unknown) => Alert.alert("Couldn't remove it", e instanceof Error ? e.message : String(e))),
        },
      ],
    );

  return (
    <>
      <Text className="text-xs font-semibold text-ink-muted uppercase mt-8 mb-2 ml-1">Phones in your family</Text>
      <Card>
        {members.map((m) =>
          m.isMe && editing ? (
            <View key={m.id} className="px-4 py-2.5 border-b border-line">
              <TextField value={name} onChangeText={setName} autoFocus onBlur={rename} onSubmitEditing={rename} returnKeyType="done" />
            </View>
          ) : (
            <Row
              key={m.id}
              label={nameOf(m.id)}
              value={m.isMe ? 'This phone' : undefined}
              onPress={
                m.isMe
                  ? () => {
                      setName(nameOf(m.id));
                      setEditing(true);
                    }
                  : undefined
              }
              right={
                m.isMe ? undefined : (
                  <Pressable onPress={() => confirmRemove(m.id)} hitSlop={8} className="ml-3">
                    <Text className="text-red-soft text-sm">Remove</Text>
                  </Pressable>
                )
              }
            />
          ),
        )}
      </Card>
      <Text className="text-ink-faint text-xs mt-2 ml-1">Tap this phone to rename it.</Text>
      <Button label="Add a phone" onPress={() => router.push('/sync/add')} />
    </>
  );
}
