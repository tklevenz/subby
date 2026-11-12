import { t } from '@subby/shared/i18n';
import { confirmDestructive } from '../../components/confirmDestructive';
import { errorMessage } from '../../features/errorMessage';
import { useAsyncAction } from '../../features/useAsyncAction';
import React, { useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useActiveChild } from '../../store/useActiveChild';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useFormatTime, useNow } from '../../store/timeHelpers';
import { defaultDeviceName, pushDeviceName, setUpSync, syncNow, turnOffSync } from '../../features/sync/engine';
import { useShallow } from 'zustand/react/shallow';
import { useSyncStore } from '../../features/sync/state';
import { progressLabel } from '../../components/SyncSteps';
import { removeDevice } from '../../features/sync/family';
import { Button, Card, Row, TextField, ErrorText, WarningText, Lead, SectionLabel, Chevron, Hint, ScreenTitle } from '../../components/ui';
import { useServerChoice } from '../../components/ServerChoice';
import { SubSpinner, SyncPing } from '../../components/brand/loaders';
import { accessLabel, AccessCard, AccessDevTools, GiftSlot, PhotoStorage } from '../../components/SyncAccess';
import { PRICE, useAccessStore } from '../../features/sync/access';
import { serverLabel } from '../../features/sync/api';
import { ScreenScroll } from '../../components/ScreenScroll';
import { clockOffText } from '../../components/SyncStopped';

/** Sync between phones: set up or join, status, the family's phones, turning it off. */
export default function SyncScreen() {
  const sync = useSettingsStore((s) => s.sync);
  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
      {sync ? <Status /> : <SetUp />}
    </ScreenScroll>
  );
}

function SetUp() {
  const child = useActiveChild();
  const { server, ready, custom, field, toggle } = useServerChoice();
  const { run, busy, error } = useAsyncAction();

  const start = () =>
    run(async () => {
      await setUpSync(server, defaultDeviceName());
      // The family now lives on one phone only: offer the recovery key right away (it can be skipped).
      router.push({ pathname: '/sync/recovery', params: { after: 'setup' } });
    });

  return (
    <>
      <ScreenTitle>{t('syncScreen.title')}</ScreenTitle>
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
  // Only the fields shown, so a change to the others (lastError, movedTo) doesn't re-render the screen.
  const { phase, error, pending: waiting, progress, removed, identityLost, tooLarge, clockOff, members } = useSyncStore(
    useShallow((s) => ({ phase: s.phase, error: s.error, pending: s.pending, progress: s.progress, removed: s.removed, identityLost: s.identityLost, tooLarge: s.tooLarge, clockOff: s.clockOff, members: s.members })),
  );
  // Entries too large to sync stay pending; they're reported on their own, not as "waiting".
  const pending = Math.max(0, waiting - tooLarge);
  const formatTime = useFormatTime();
  useNow(30_000);

  const state =
    phase === 'syncing'
      ? progress
        ? progressLabel(progress)
        : t('syncScreen.syncing')
      : phase === 'error'
        ? t('syncScreen.error')
        : pending
          ? t('syncScreen.waiting', { count: pending })
          : t('syncScreen.upToDate');

  const lastPhone = members.length <= 1;
  const confirmOff = () =>
    confirmDestructive({
      title: t('syncScreen.offTitle'),
      text: lastPhone ? t('syncScreen.offLast') : t('syncScreen.offLeave'),
      action: t('syncScreen.turnOff'),
      onConfirm: () => turnOffSync(),
    });

  // A restored backup or a new phone: the data came along, this phone's place in the family didn't.
  if (identityLost) {
    return (
      <>
        <ScreenTitle>{t('sync.error.identityLost')}</ScreenTitle>
        <Lead className="mt-2">{t('syncScreen.identityLostText')}</Lead>
        <Button label={t('syncScreen.joinAgain')} onPress={() => void turnOffSync().then(() => router.push('/sync/join'))} />
      </>
    );
  }

  if (removed) {
    return (
      <>
        <ScreenTitle>{t('syncScreen.removed')}</ScreenTitle>
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
        <Row label={t('syncScreen.server')} value={serverLabel(sync.server)} />
        <PhotoStorage />
        <Row label={t('syncScreen.move')} onPress={() => router.push('/sync/move')} right={<Chevron />} />
      </Card>
      {phase === 'error' && error ? <ErrorText className="mt-3 ml-1">{error}</ErrorText> : null}
      {clockOff !== null ? <WarningText className="mt-3 ml-1">{clockOffText(clockOff)}</WarningText> : null}
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
          <Hint className="ml-1">{t('syncScreen.lostPaper')}</Hint>
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
      await pushDeviceName(name.trim()).catch((e: unknown) => Alert.alert(t('syncScreen.renameFailed'), errorMessage(e)));
    }
  };

  const confirmRemove = (id: string) =>
    confirmDestructive({
      title: t('syncScreen.removeTitle', { name: nameOf(id) }),
      text: t('syncScreen.removeText'),
      action: t('syncScreen.remove'),
      onConfirm: () => removeDevice(id).catch((e: unknown) => Alert.alert(t('syncScreen.removeFailed'), errorMessage(e))),
    });

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
              action={
                m.isMe ? undefined : (
                  <Pressable onPress={() => confirmRemove(m.id)} hitSlop={8}>
                    <Text className="text-red-soft text-sm">{t('syncScreen.remove')}</Text>
                  </Pressable>
                )
              }
            />
          ),
        )}
      </Card>
      <Hint className="ml-1">{t('syncScreen.tapRename')}</Hint>
      <Button label={t('syncScreen.addPhone')} onPress={() => router.push('/sync/add')} />
      <GiftSlot />
    </>
  );
}
