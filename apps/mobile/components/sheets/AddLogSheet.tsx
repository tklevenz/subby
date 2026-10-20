import React from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LOG_TYPES } from '@kindred-log/shared';
import { useSheetStore } from '../../store/useSheetStore';
import { TYPE_META } from '../logTypes';

/** Grid of every log type; second tap of the 2-tap rule for anything not on the dock. */
export default function AddLogSheet() {
  const open = useSheetStore((s) => s.open);

  return (
    <View className="flex-row flex-wrap gap-3 pt-2">
        {LOG_TYPES.map((type) => {
          const { label, Icon, color, bg } = TYPE_META[type];
          return (
            <Pressable
              key={type}
              onPress={() => {
                Haptics.selectionAsync();
                open(type === 'feed' ? { kind: 'feed' } : { kind: 'log', type });
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
