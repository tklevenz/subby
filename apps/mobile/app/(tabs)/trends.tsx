import React from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TrendsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-slate-950 px-4" style={{ paddingTop: insets.top }}>
      <Text className="text-xl font-bold text-white mt-2">Trends</Text>
      <Text className="text-slate-500 mt-4">Sleep, feeding and growth trends are coming soon.</Text>
    </View>
  );
}
