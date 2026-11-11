import { t } from '@subby/shared/i18n';
import React from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import ChildSwitcher from './ChildSwitcher';
import { Plus } from './icons';
import { useSheetStore } from '../store/useSheetStore';
import { colors } from '../theme/colors';

/** Everything without a tile of its own ("Log something"); replaced the recent-category shortcuts (canvas row "Home · only the +", D). */
function LogButton({ at }: { at?: number }) {
  const open = useSheetStore((s) => s.open);
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        open({ kind: 'add', at });
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

/**
 * The child (switch, open the profile) and the round +, on Home, History and Trends: the screens that show one
 * child's log. The tab bar names the screen, so there's no title. The + opens the tabs' shared log sheet; `logAt`
 * starts what it logs on another day (History).
 */
export default function TabHeader({ className = 'mb-4', logAt }: { className?: string; logAt?: number }) {
  return (
    <View className={`mx-4 mt-2 flex-row items-center ${className}`}>
      <View className="flex-1">
        <ChildSwitcher />
      </View>
      <LogButton at={logAt} />
    </View>
  );
}
