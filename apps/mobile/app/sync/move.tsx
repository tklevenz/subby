import { t } from '@subby/shared/i18n';
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSyncStore } from '../../features/sync/engine';
import { moveToServer } from '../../features/sync/move';
import { isOfficialServer } from '../../features/sync/api';
import { PRICE } from '../../features/sync/access';
import { Button, ErrorText, Lead } from '../../components/ui';
import { SubLoader } from '../../components/brand/loaders';
import { useServerChoice } from '../../components/ServerChoice';
import { ScreenScroll } from '../../components/ScreenScroll';

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
    setStep({ kind: 'working', label: t('move.ready') });
    try {
      await moveToServer(server, (label) => setStep({ kind: 'working', label }));
      Alert.alert(
        t('move.moved'),
        t(members > 1 ? 'move.movedOthers' : 'move.movedAlone', { server: host(server) }),
      );
      router.back();
    } catch (e) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const confirm = () =>
    Alert.alert(t('move.confirmTitle', { server: host(server) }), t('move.confirmText', { from }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('move.move'), onPress: run },
    ]);

  return (
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {step.kind === 'working' ? (
        <View className="items-center mt-24">
          <SubLoader />
          <Text className="text-ink-muted mt-4 text-center">{step.label}</Text>
          <Text className="text-ink-faint text-xs mt-2 text-center">{t('move.keepOpen')}</Text>
        </View>
      ) : (
        <>
          <Lead>
            {t('move.lead', { from })}
            {members > 1 ? t('move.leadOthers') : ''}
            {t('move.leadEnd', { from })}
          </Lead>

          {field}
          {step.kind === 'error' ? <ErrorText className="mt-4">{step.message}</ErrorText> : null}
          <Button label={t(custom ? 'move.toThis' : 'move.toOfficial')} onPress={confirm} disabled={!ready} />
          <Text className="text-ink-faint text-xs text-center mt-3 leading-4">
            {custom ? t('move.ownFree') : t('move.trial', { price: PRICE })}
          </Text>
          {toggle}
        </>
      )}
    </ScreenScroll>
  );
}
