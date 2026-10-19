import React from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LogTimeline from '../../components/LogTimeline';
import { useLogStore } from '../../store/useLogStore';

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const loadOlder = useLogStore((s) => s.loadOlder);

  return (
    <View className="flex-1 bg-slate-950" style={{ paddingTop: insets.top }}>
      <Text className="text-xl font-bold text-white mx-4 mt-2 mb-2">History</Text>
      <LogTimeline onEndReached={loadOlder} />
    </View>
  );
}
