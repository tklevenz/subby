import { t } from '@subby/shared/i18n';
import { errorMessage } from '../../features/errorMessage';
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSyncStore } from '../../features/sync/state';
import { moveToServer } from '../../features/sync/move';
import { isOfficialServer, serverLabel } from '../../features/sync/api';
import { PRICE } from '../../features/sync/access';
import { Button, ErrorText, Lead } from '../../components/ui';
import { SubLoader } from '../../components/brand/loaders';
import { useServerChoice } from '../../components/ServerChoice';
import { ScreenScroll } from '../../components/ScreenScroll';

type Step = { kind: 'choose' } | { kind: 'working'; label: string } | { kind: 'error'; message: string };


/** Moves the family to another server (Subby Sync or your own); the other phones follow by themselves. */
export default function MoveScreen() {
  const sync = useSettingsStore((s) => s.sync);
  const members = useSyncStore((s) => s.members.length);
  const onOfficial = sync ? isOfficialServer(sync.server) : false;
  const { server, ready, custom, field, toggle } = useServerChoice({ customOnly: onOfficial });
  const [step, setStep] = useState<Step>({ kind: 'choose' });

  if (!sync) return null;
  const from = serverLabel(sync.server);

  const run = async () => {
    setStep({ kind: 'working', label: t('move.ready') });
    try {
      await moveToServer(server, (label) => setStep({ kind: 'working', label }));
      Alert.alert(
        t('move.moved'),
        t(members > 1 ? 'move.movedOthers' : 'move.movedAlone', { server: serverLabel(server) }),
      );
      router.back();
    } catch (e) {
      setStep({ kind: 'error', message: errorMessage(e) });
    }
  };

  const confirm = () =>
    Alert.alert(t('move.confirmTitle', { server: serverLabel(server) }), t('move.confirmText', { from }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('move.move'), onPress: run },
    ]);

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
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
