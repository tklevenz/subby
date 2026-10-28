import React from 'react';
import { Text, View } from 'react-native';
import { RestingSub } from './Sub';

/** Nothing here yet: the sub asleep on the sea floor, an optional title and the text. */
export function EmptyState({ title, text, small = false }: { title?: string; text: string; small?: boolean }) {
  return (
    <View className={`items-center ${small ? 'mt-6' : 'mt-10'}`}>
      <RestingSub width={small ? 110 : 150} />
      {title ? <Text className="text-ink-bright text-base font-semibold mt-3">{title}</Text> : null}
      <Text className={`text-ink-faint text-center ${title ? 'mt-1' : 'mt-3'}`}>{text}</Text>
    </View>
  );
}
