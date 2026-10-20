import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActiveTimers from '../../components/ActiveTimers';
import ChildSwitcher from '../../components/ChildSwitcher';
import HomeTiles from '../../components/home/HomeTiles';
import SheetHost from '../../components/sheets/SheetHost';
import { useActiveChild } from '../../store/useActiveChild';

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const child = useActiveChild();

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="mx-4 mt-2">
        <ChildSwitcher />
      </View>
      <ActiveTimers />
      <View className="flex-1 mt-2">{child ? <HomeTiles child={child} /> : null}</View>
      <SheetHost />
    </View>
  );
}
