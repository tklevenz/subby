import { t } from '@subby/shared/i18n';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FieldLabel, TextField } from './ui';
import { OFFICIAL_SERVER } from '../features/sync/api';

/**
 * Which sync server to use: Subby Sync unless asked otherwise. The address field only shows for your own server.
 * `field` goes above the action button, `toggle` below it. `customOnly`: already on Subby Sync, so only another server.
 */
export function useServerChoice({ customOnly = false } = {}) {
  const [custom, setCustom] = useState(customOnly);
  const [address, setAddress] = useState('');

  const field = custom ? (
    <View className="mt-2">
      <FieldLabel>{t('server.yours')}</FieldLabel>
      <TextField value={address} onChangeText={setAddress} placeholder="https://sync.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
    </View>
  ) : null;

  const toggle = customOnly ? null : (
    <Pressable onPress={() => setCustom(!custom)} hitSlop={8} className="items-center mt-4">
      <Text className="text-violet-soft text-sm">{t(custom ? 'server.useOfficial' : 'server.useOwn')}</Text>
    </Pressable>
  );

  return { server: custom ? address : OFFICIAL_SERVER, ready: !custom || address.trim().length > 0, custom, field, toggle };
}
