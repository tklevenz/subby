import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSyncStore } from '../../features/sync/engine';
import { moveToServer } from '../../features/sync/move';
import { isOfficialServer } from '../../features/sync/api';
import { PRICE } from '../../features/sync/access';
import { Button } from '../../components/ui';
import { SubLoader } from '../../components/brand/loaders';
import { useServerChoice } from '../../components/ServerChoice';

type Step = { kind: 'choose' } | { kind: 'working'; label: string } | { kind: 'error'; message: string };

const host = (server: string) => (isOfficialServer(server) ? 'Subby Sync' : server.replace(/^https?:\/\//, ''));

/** Moves the family to another server (Subby Sync or your own); the other phones follow by themselves. */
export default function MoveScreen() {
  const sync = useSettingsStore((s) => s.sync);
  const members = useSyncStore((s) => s.members.length);
  const onOfficial = sync ? isOfficialServer(sync.server) : false;
  const { server, ready, custom, field, toggle } = useServerChoice({ customOnly: onOfficial });
  const [step, setStep] = useState<Step>({ kind: 'choose' });

  if (!sync) return null;
  const from = host(sync.server);

  const run = async () => {
    setStep({ kind: 'working', label: 'Getting ready' });
    try {
      await moveToServer(server, (label) => setStep({ kind: 'working', label }));
      Alert.alert(
        'Moved',
        members > 1
          ? `Your family now syncs through ${host(server)}. The other phones follow the next time they sync.`
          : `Your family now syncs through ${host(server)}.`,
      );
      router.back();
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const confirm = () =>
    Alert.alert(`Move to ${host(server)}?`, `Everything is copied there, then your family is deleted from ${from}. Keep the app open until it's done.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move', onPress: run },
    ]);

  return (
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {step.kind === 'working' ? (
        <View className="items-center mt-24">
          <SubLoader />
          <Text className="text-ink-muted mt-4 text-center">{step.label}</Text>
          <Text className="text-ink-faint text-xs mt-2 text-center">Keep the app open.</Text>
        </View>
      ) : (
        <>
          <Text className="text-ink text-xl font-bold">Move to another server</Text>
          <Text className="text-ink-soft text-[15px] leading-[22px] mt-2">
            Your family syncs through {from} now. Moving copies every entry and photo to the new server, encrypted on this phone like
            always.
            {members > 1 ? ' The other phones follow by themselves the next time they sync; nobody needs a new code.' : ''} Your recovery
            words keep working. Afterwards, your family is deleted from {from}.
          </Text>

          {field}
          {step.kind === 'error' ? <Text className="text-red-soft text-sm mt-4">{step.message}</Text> : null}
          <Button label={`Move to ${custom ? 'this server' : 'Subby Sync'}`} onPress={confirm} disabled={!ready} />
          <Text className="text-ink-faint text-xs text-center mt-3 leading-4">
            {custom ? 'Syncing through your own server is free.' : `14 days free for every phone, then ${PRICE} per phone, once.`}
          </Text>
          {toggle}
        </>
      )}
    </ScrollView>
  );
}
