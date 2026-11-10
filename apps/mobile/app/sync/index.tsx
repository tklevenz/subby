import { t } from '@subby/shared/i18n';
import React, { useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useActiveChild } from '../../store/useActiveChild';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useFormatTime, useNow } from '../../store/timeHelpers';
import { deleteFamilyOnServer, pushDeviceName, setUpSync, syncNow, turnOffSync, useSyncStore } from '../../features/sync/engine';
import { defaultDeviceName, removeDevice } from '../../features/sync/family';
import { Button, Card, Row, TextField, ErrorText, WarningText, Lead, SectionLabel, Chevron } from '../../components/ui';
import { useServerChoice } from '../../components/ServerChoice';
import { SubSpinner, SyncPing } from '../../components/brand/loaders';
import { accessLabel, AccessCard, AccessDevTools, GiftSlot, PhotoStorage } from '../../components/SyncAccess';
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
      <Text className="text-ink text-xl font-bold">{t('syncScreen.title')}</Text>
      <Lead className="mt-2">
        {t('syncScreen.lead', { name: child?.name ?? t('syncScreen.yourChild') })}
      </Lead>

      <SectionLabel>{t('syncScreen.otherSyncs')}</SectionLabel>
      <Button label={t('syncScreen.joinWithCode')} variant="ghost" onPress={() => router.push('/sync/join')} />

      <SectionLabel>{t('syncScreen.startHere')}</SectionLabel>
      {field}
      {error ? <ErrorText className="mt-4">{error}</ErrorText> : null}
      <Button label={t(busy ? 'syncScreen.settingUp' : 'syncScreen.setUp')} onPress={start} disabled={busy || !ready} />
      <Text className="text-ink-faint text-xs text-center mt-3 leading-4">
        {t('syncScreen.firstPhone')}
        {custom ? t('syncScreen.ownFree') : t('syncScreen.trial', { price: PRICE })}
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
        ? t('syncScreen.progress', { label: progress.label, count: progress.done })
        : t('syncScreen.syncing')
      : phase === 'error'
        ? t('syncScreen.error')
        : pending
          ? t('syncScreen.waiting', { count: pending })
          : t('syncScreen.upToDate');

  const lastPhone = members.length <= 1;
  const confirmOff = () =>
    Alert.alert(
      t('syncScreen.offTitle'),
      lastPhone ? t('syncScreen.offLast') : t('syncScreen.offLeave'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('syncScreen.turnOff'), style: 'destructive', onPress: () => turnOffSync() },
      ],
    );

  const confirmDelete = () =>
    Alert.alert(
      t('syncScreen.deleteTitle'),
      t('syncScreen.deleteText'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => deleteFamilyOnServer().catch((e: unknown) => Alert.alert(t('syncScreen.deleteFailed'), e instanceof Error ? e.message : String(e))),
        },
      ],
    );

  if (removed) {
    return (
      <>
        <Text className="text-ink text-xl font-bold">{t('syncScreen.removed')}</Text>
        <Lead className="mt-2">
          {t('syncScreen.removedText')}
        </Lead>
        <Button label={t('syncScreen.turnOffHere')} onPress={() => turnOffSync()} />
      </>
    );
  }

  return (
    <>
      <Card>
        <Row
          label={t('syncScreen.status')}
          value={state}
          right={
            phase === 'syncing' ? <SubSpinner size={24} /> : phase !== 'error' && !pending && sync.lastSyncedAt ? <SyncPing key={sync.lastSyncedAt} /> : undefined
          }
        />
        <Row label={t('syncScreen.lastSynced')} value={sync.lastSyncedAt ? formatTime(sync.lastSyncedAt) : t('syncScreen.notYet')} />
        <Row label={t('syncScreen.server')} value={isOfficialServer(sync.server) ? 'Subby Sync' : sync.server.replace(/^https?:\/\//, '')} />
        <PhotoStorage />
        <Row label={t('syncScreen.move')} onPress={() => router.push('/sync/move')} right={<Chevron />} />
      </Card>
      {phase === 'error' && error ? <ErrorText className="mt-3 ml-1">{error}</ErrorText> : null}
      {tooLarge ? (
        <WarningText className="mt-3 ml-1">
          {t('syncScreen.tooLarge', { count: tooLarge })}
        </WarningText>
      ) : null}
      <Button label={t('syncScreen.syncNow')} variant="ghost" onPress={() => syncNow().catch(() => {})} disabled={phase === 'syncing'} />

      <AccessCard />
      <Phones />
      <Recovery />

      {/* For support (e.g. a gifted unlock from us); not a secret. */}
      <View className="mt-8">
        <Card>
          <Row label={t('syncScreen.familyId')} value={`${sync.familyId.slice(0, 8)}…`} onPress={() => Share.share({ message: sync.familyId })} />
        </Card>
      </View>

      <View className="mt-4">
        <Button label={t('syncScreen.turnOffHere')} variant="dangerQuiet" onPress={confirmOff} />
        {!lastPhone ? <Button label={t('syncScreen.deleteFamily')} variant="dangerQuiet" onPress={confirmDelete} /> : null}
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
      <SectionLabel>{t('syncScreen.recovery')}</SectionLabel>
      {hasRecovery ? (
        <>
          <Card>
            <Row label={t('syncScreen.recovery')} value={t('syncScreen.recoverySaved')} onPress={open} right={<Chevron />} />
          </Card>
          <Text className="text-ink-faint text-xs mt-2 ml-1">{t('syncScreen.lostPaper')}</Text>
        </>
      ) : (
        <View className={`rounded-2xl px-4 py-4 border ${alone ? 'bg-violet/10 border-violet/40' : 'bg-surface border-line'}`}>
          <Text className="text-ink text-[15px] leading-[22px]">
            {alone
              ? t('syncScreen.onlyThisPhone')
              : t('syncScreen.everyPhoneLost')}
          </Text>
          <Button label={t('syncScreen.createRecovery')} variant={alone ? 'primary' : 'ghost'} onPress={open} />
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
  const nameOf = (id: string) => sync.names?.[id] ?? t('syncScreen.phone');

  const rename = async () => {
    setEditing(false);
    if (name.trim() && name.trim() !== nameOf(sync.deviceId)) {
      await pushDeviceName(name.trim()).catch((e: unknown) => Alert.alert(t('syncScreen.renameFailed'), e instanceof Error ? e.message : String(e)));
    }
  };

  const confirmRemove = (id: string) =>
    Alert.alert(
      t('syncScreen.removeTitle', { name: nameOf(id) }),
      t('syncScreen.removeText'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('syncScreen.remove'),
          style: 'destructive',
          onPress: () =>
            removeDevice(id).catch((e: unknown) => Alert.alert(t('syncScreen.removeFailed'), e instanceof Error ? e.message : String(e))),
        },
      ],
    );

  return (
    <>
      <SectionLabel>{t('syncScreen.phones')}</SectionLabel>
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
              value={[m.isMe ? t('syncScreen.thisPhone') : undefined, accessLabel(accessOf.get(m.id) ?? 'free')].filter(Boolean).join(' · ') || undefined}
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
                    <Text className="text-red-soft text-sm">{t('syncScreen.remove')}</Text>
                  </Pressable>
                )
              }
            />
          ),
        )}
      </Card>
      <Text className="text-ink-faint text-xs mt-2 ml-1">{t('syncScreen.tapRename')}</Text>
      <Button label={t('syncScreen.addPhone')} onPress={() => router.push('/sync/add')} />
      <GiftSlot />
    </>
  );
}
