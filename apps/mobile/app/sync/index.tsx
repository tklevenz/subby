import React, { useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useActiveChild } from '../../store/useActiveChild';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useFormatTime, useNow } from '../../store/timeHelpers';
import { deleteFamilyOnServer, pushDeviceName, setUpSync, syncNow, turnOffSync, useSyncStore } from '../../features/sync/engine';
import { defaultDeviceName, removeDevice } from '../../features/sync/family';
import { Button, Card, Row, TextField } from '../../components/ui';
import { useServerChoice } from '../../components/ServerChoice';
import { SubSpinner, SyncPing } from '../../components/brand/loaders';
import { ACCESS_LABEL, AccessCard, AccessDevTools, GiftSlot } from '../../components/SyncAccess';
import { PRICE, useAccessStore } from '../../features/sync/access';
import { isOfficialServer } from '../../features/sync/api';
import { ScreenScroll } from '../../components/ScreenScroll';

/** Sync between phones: set up or join, status, the family's phones, turning it off. */
export default function SyncScreen() {
  const sync = useSettingsStore((s) => s.sync);
  return (
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {sync ? <Status /> : <SetUp />}
    </ScreenScroll>
  );
}

function SetUp() {
  const child = useActiveChild();
  const { server, ready, custom, field, toggle } = useServerChoice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await setUpSync(server, defaultDeviceName());
      // The family now lives on one phone only: offer the recovery key right away (it can be skipped).
      router.push({ pathname: '/sync/recovery', params: { after: 'setup' } });
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
      {field}
      {error ? <Text className="text-red-soft text-sm mt-4">{error}</Text> : null}
      <Button label={busy ? 'Setting up…' : 'Set up sync'} onPress={start} disabled={busy || !ready} />
      <Text className="text-ink-faint text-xs text-center mt-3 leading-4">
        This phone becomes the first phone in your family.
        {custom ? ' Syncing through your own server is free.' : ` 14 days free, then ${PRICE} per phone, once.`}
      </Text>
      {toggle}
    </>
  );
}

function Status() {
  const sync = useSettingsStore((s) => s.sync)!;
  const { phase, error, pending: waiting, progress, removed, tooLarge, members } = useSyncStore();
  // Entries too large to sync stay pending; they're reported on their own, not as "waiting".
  const pending = Math.max(0, waiting - tooLarge);
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

  const lastPhone = members.length <= 1;
  const confirmOff = () =>
    Alert.alert(
      'Turn off sync on this phone?',
      lastPhone
        ? "Everything stays on this phone. It's the only phone in the family, so the family and its data are deleted from the server, recovery key included."
        : 'Everything stays on this phone, but it leaves the family and stops syncing. Joining again needs a new code from another phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => turnOffSync() },
      ],
    );

  const confirmDelete = () =>
    Alert.alert(
      'Delete the family from the server?',
      'Everything the server holds for your family is deleted: entries, photos, keys and the recovery key. Every phone keeps what it has, but none of them syncs any more. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteFamilyOnServer().catch((e: unknown) => Alert.alert("Couldn't delete it", e instanceof Error ? e.message : String(e))),
        },
      ],
    );

  if (removed) {
    return (
      <>
        <Text className="text-ink text-xl font-bold">This phone is no longer in the family</Text>
        <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
          Another phone removed it, or deleted the family from the server, so it no longer syncs. Everything already on this phone
          stays here. To sync again, turn sync off, then join with a new code from a phone in the family, or set up sync anew.
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
          right={
            phase === 'syncing' ? <SubSpinner size={24} /> : phase !== 'error' && !pending && sync.lastSyncedAt ? <SyncPing key={sync.lastSyncedAt} /> : undefined
          }
        />
        <Row label="Last synced" value={sync.lastSyncedAt ? formatTime(sync.lastSyncedAt) : 'Not yet'} />
        <Row label="Server" value={isOfficialServer(sync.server) ? 'Subby Sync' : sync.server.replace(/^https?:\/\//, '')} />
        <Row label="Move to another server" onPress={() => router.push('/sync/move')} />
      </Card>
      {phase === 'error' && error ? <Text className="text-red-soft text-sm mt-3 ml-1">{error}</Text> : null}
      {tooLarge ? (
        <Text className="text-amber-soft text-sm mt-3 ml-1 leading-5">
          {tooLarge === 1 ? '1 entry is' : `${tooLarge.toLocaleString()} entries are`} too large to sync (a very long note?) and stay
          on this phone only. Shortening it lets it sync.
        </Text>
      ) : null}
      <Button label="Sync now" variant="ghost" onPress={() => syncNow().catch(() => {})} disabled={phase === 'syncing'} />

      <AccessCard />
      <Phones />
      <Recovery />

      {/* For support (e.g. a gifted unlock from us); not a secret. */}
      <View className="mt-8">
        <Card>
          <Row label="Family id" value={`${sync.familyId.slice(0, 8)}…`} onPress={() => Share.share({ message: sync.familyId })} />
        </Card>
      </View>

      <View className="mt-4">
        <Button label="Turn off sync on this phone" variant="danger" onPress={confirmOff} />
        {!lastPhone ? <Button label="Delete the family from the server" variant="danger" onPress={confirmDelete} /> : null}
      </View>
      <AccessDevTools />
    </>
  );
}

/** The recovery key: set or not, and a nudge when this phone is the only copy of the family's data. */
function Recovery() {
  const hasRecovery = useSyncStore((s) => s.hasRecovery);
  const alone = useSyncStore((s) => s.members.length === 1);
  const open = () => router.push('/sync/recovery');

  return (
    <>
      <Text className="text-xs font-semibold text-ink-muted uppercase mt-8 mb-2 ml-1">Recovery key</Text>
      {hasRecovery ? (
        <>
          <Card>
            <Row label="Recovery key" value="Saved" onPress={open} />
          </Card>
          <Text className="text-ink-faint text-xs mt-2 ml-1">Lost the paper? Make new words; the old ones stop working.</Text>
        </>
      ) : (
        <View className={`rounded-2xl px-4 py-4 border ${alone ? 'bg-violet/10 border-violet/40' : 'bg-surface border-line'}`}>
          <Text className="text-ink text-[15px] leading-[22px]">
            {alone
              ? "Only this phone has your family's data. If it's lost, the data is gone, unless you have a recovery key."
              : "If every phone in the family is lost, a recovery key is the only way to get the data back."}
          </Text>
          <Button label="Create a recovery key" variant={alone ? 'primary' : 'ghost'} onPress={open} />
        </View>
      )}
    </>
  );
}

function Phones() {
  const sync = useSettingsStore((s) => s.sync)!;
  const members = useSyncStore((s) => s.members);
  const entitlement = useAccessStore((s) => s.entitlement);
  const accessOf = new Map(entitlement?.devices.map((d) => [d.id, d.access]));
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
              value={[m.isMe ? 'This phone' : undefined, ACCESS_LABEL[accessOf.get(m.id) ?? 'free']].filter(Boolean).join(' · ') || undefined}
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
      <GiftSlot />
    </>
  );
}
