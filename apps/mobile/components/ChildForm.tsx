import React, { useState } from 'react';
import { Pressable, View, Text } from 'react-native';
import { Camera } from './icons';
import type { Child } from '@subby/shared';
import type { ChildInput } from '../store/useChildStore';
import { fromIsoDate, toIsoDate } from '../store/timeHelpers';
import ChildAvatar from './ChildAvatar';
import DateTimeField from './DateTimeField';
import PhotoMenu from './PhotoMenu';
import { Button, FieldLabel, Segmented, TextField } from './ui';
import { colors } from '../theme/colors';

const SEX_OPTIONS = [
  { value: 'female', label: 'Girl' },
  { value: 'male', label: 'Boy' },
  { value: 'other', label: 'Other' },
] as const;

/** Create/edit form for a child profile. */
export default function ChildForm({
  initial,
  submitLabel,
  onSubmit,
  autoFocus = !initial,
}: {
  initial?: Child;
  /** Open with the keyboard up on the name (not where there's more to see below, like onboarding). */
  autoFocus?: boolean;
  submitLabel: string;
  onSubmit: (input: ChildInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? toIsoDate(Date.now()));
  const [sex, setSex] = useState<Child['sex']>(initial?.sex ?? null);
  const [photoUri, setPhotoUri] = useState<string | null>(initial?.photoUri ?? null);
  const [menu, setMenu] = useState(false);

  return (
    <View>
      <Pressable onPress={() => setMenu(true)} className="items-center mt-2 mb-2">
        <ChildAvatar child={{ id: initial?.id ?? 'new', name: name || '?', photoUri }} size={96} />
        <View className="flex-row items-center mt-2">
          <Camera color={colors.violetStrong} size={14} />
          <Text className="text-violet-soft text-sm ml-1.5">{photoUri ? 'Change photo' : 'Add a photo'}</Text>
        </View>
      </Pressable>
      <PhotoMenu visible={menu} hasPhoto={photoUri !== null} onClose={() => setMenu(false)} onChange={setPhotoUri} />

      <FieldLabel>Name</FieldLabel>
      <TextField value={name} onChangeText={setName} placeholder="Baby's name" autoFocus={autoFocus} />

      <FieldLabel>Birth date</FieldLabel>
      <DateTimeField
        mode="date"
        title="Birth date"
        value={fromIsoDate(birthDate)}
        maximumDate={new Date()}
        onChange={(ms) => setBirthDate(toIsoDate(ms))}
      />

      <FieldLabel>Sex (for growth percentiles)</FieldLabel>
      <Segmented options={SEX_OPTIONS} value={sex} onChange={setSex} />

      <Button
        label={submitLabel}
        disabled={name.trim().length === 0}
        onPress={() => onSubmit({ name: name.trim(), birthDate, sex, photoUri })}
      />
    </View>
  );
}
