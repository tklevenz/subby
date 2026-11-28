import { t } from '@subby/shared/i18n';
import React from 'react';
import { Text, View } from 'react-native';
import { Hint, Lead } from '../../components/ui';
import { ScreenScroll } from '../../components/ScreenScroll';

/**
 * How to move the family to another server by hand: turn sync off everywhere, set up on the new server, add the
 * other phones. The app doesn't move families itself (LAUNCH.md A18); every move involves a self-hosted server,
 * so someone in the family runs one.
 */
export default function MoveScreen() {
  const steps = [
    t('move.step.off', { sync: t('screen.sync'), off: t('syncScreen.turnOffHere') }),
    t('move.step.setUp', { setUp: t('syncScreen.setUp'), own: t('server.useOwn') }),
    t('move.step.add', { add: t('syncScreen.addPhone'), join: t('syncScreen.joinWithCode'), merge: t('join.merge') }),
    t('move.step.recovery'),
  ];
  return (
    <ScreenScroll>
      <Lead>{t('move.lead')}</Lead>
      {steps.map((step, i) => (
        <View key={i} accessible className="flex-row mt-4">
          <Text className="text-violet-soft text-[15px] leading-[22px] font-bold w-6">{i + 1}</Text>
          <Text className="flex-1 text-ink text-[15px] leading-[22px]">{step}</Text>
        </View>
      ))}
      <Hint className="mt-6">{t('move.oldServer')}</Hint>
    </ScreenScroll>
  );
}
