import React from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSheetStore } from '../../store/useSheetStore';
import { LOG_TILE_KEYS, logTile } from '../logTypes';

/** Grid of everything that can be logged; second tap of the 2-tap rule for anything not on the dock. */
export default function AddLogSheet() {
  const open = useSheetStore((s) => s.open);

  return (
    <View className="flex-row flex-wrap gap-3 pt-2">
        {LOG_TILE_KEYS.map(logTile).map(({ key, label, Icon, color, bg, request }) => {
          return (
            <Pressable
              key={key}
              onPress={() => {
                Haptics.selectionAsync();
                open(request);
              }}
              className={`items-center justify-center rounded-2xl border py-4 ${bg}`}
              style={{ width: '30.5%' }}
            >
              <Icon color={color} size={24} />
              <Text className="text-ink text-xs font-medium mt-2">{label}</Text>
            </Pressable>
          );
        })}
    </View>
  );
}
