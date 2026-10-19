import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StatusHeader from '../../components/StatusHeader';
import ActiveTimers from '../../components/ActiveTimers';
import LogTimeline from '../../components/LogTimeline';
import QuickActionDock from '../../components/QuickActionDock';
import SheetHost from '../../components/sheets/SheetHost';
import { useNow } from '../../store/timeHelpers';

const DAY_MS = 86_400_000;

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  // Home shows the last 24 h; the History tab has everything. Re-evaluated each minute.
  const now = useNow(60_000);

  return (
    <View className="flex-1 bg-slate-950" style={{ paddingTop: insets.top }}>
      <View className="flex-1">
        <StatusHeader />
        <ActiveTimers />
        <LogTimeline sinceMs={now - DAY_MS} />
      </View>

      <QuickActionDock />
      <SheetHost />
    </View>
  );
}
