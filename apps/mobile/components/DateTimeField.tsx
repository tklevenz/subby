import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { formatDayLabel, useFormatTime } from '../store/timeHelpers';

/**
 * Date + time picker for epoch ms. iOS shows the compact inline picker;
 * Android opens the native date dialog followed by the time dialog.
 */
export default function DateTimeField({
  value,
  onChange,
  mode = 'datetime',
  maximumDate,
}: {
  value: number;
  onChange: (ms: number) => void;
  mode?: 'datetime' | 'date';
  maximumDate?: Date;
}) {
  const formatTime = useFormatTime();
  const [iosKey, setIosKey] = useState(0);

  if (Platform.OS === 'ios') {
    return (
      <View className="flex-row items-center">
        <DateTimePicker
          key={iosKey}
          value={new Date(value)}
          mode={mode}
          display="compact"
          themeVariant="dark"
          maximumDate={maximumDate}
          onChange={(_e, d) => {
            if (d) onChange(d.getTime());
            else setIosKey((k) => k + 1);
          }}
        />
      </View>
    );
  }

  const openAndroid = () => {
    DateTimePickerAndroid.open({
      value: new Date(value),
      mode: 'date',
      maximumDate,
      onChange: (e, date) => {
        if (e.type !== 'set' || !date) return;
        if (mode === 'date') return onChange(date.getTime());
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          onChange: (e2, time) => {
            if (e2.type === 'set' && time) onChange(time.getTime());
          },
        });
      },
    });
  };

  return (
    <Pressable onPress={openAndroid} className="bg-raised border border-line-strong rounded-xl px-4 py-3 self-start">
      <Text className="text-ink text-base">
        {formatDayLabel(value)}
        {mode === 'datetime' ? ` · ${formatTime(value)}` : ''}
      </Text>
    </Pressable>
  );
}
