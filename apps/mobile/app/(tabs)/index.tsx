import { t } from '@subby/shared/i18n';
import React from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActiveTimers from '../../components/ActiveTimers';
import { AccessBanner } from '../../components/SyncAccess';
import { RecoveryNudge } from '../../components/RecoveryNudge';
import ChildSwitcher from '../../components/ChildSwitcher';
import HomeTiles from '../../components/home/HomeTiles';
import SheetHost from '../../components/sheets/SheetHost';
import { useActiveChild } from '../../store/useActiveChild';
import { useSheetStore } from '../../store/useSheetStore';
import { Plus } from '../../components/icons';
import { colors } from '../../theme/colors';

/** Everything without a tile of its own ("Log something"); replaced the recent-category shortcuts (canvas row "Home · only the +", D). */
function LogButton() {
  const open = useSheetStore((s) => s.open);
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        open({ kind: 'add' });
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('home.logSomething')}
      // The avatar's size, so the header lines up; hitSlop keeps the target large enough.
      style={{ width: 40, height: 40 }}
      className="rounded-full bg-violet/15 border border-violet/50 items-center justify-center"
    >
      <Plus color={colors.violetSoft} size={18} />
    </Pressable>
  );
}

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const child = useActiveChild();

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="mx-4 mt-2 mb-4 flex-row items-center">
        <View className="flex-1">
          <ChildSwitcher />
        </View>
        <LogButton />
      </View>
      <AccessBanner />
      <RecoveryNudge />
      <ActiveTimers />
      <View className="flex-1 mt-2">{child ? <HomeTiles child={child} /> : null}</View>
      <SheetHost />
    </View>
  );
}
