import React from 'react';
import { View } from 'react-native';
import TabHeader from '../../components/TabHeader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActiveTimers from '../../components/ActiveTimers';
import { AccessBanner } from '../../components/SyncAccess';
import { RecoveryNudge } from '../../components/RecoveryNudge';
import HomeTiles from '../../components/home/HomeTiles';
import { useActiveChild } from '../../store/useActiveChild';

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const child = useActiveChild();

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <TabHeader />
      <AccessBanner />
      <RecoveryNudge />
      <ActiveTimers />
      <View className="flex-1 mt-2">{child ? <HomeTiles child={child} /> : null}</View>
    </View>
  );
}
