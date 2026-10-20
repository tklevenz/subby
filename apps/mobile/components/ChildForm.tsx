import React, { useState } from 'react';
import { Pressable, View, Switch, Text } from 'react-native';
import { Camera } from 'lucide-react-native';
import type { Child } from '@kindred-log/shared';
import type { ChildInput } from '../store/useChildStore';
import { fromIsoDate, toIsoDate } from '../store/timeHelpers';
import ChildAvatar from './ChildAvatar';
import DateTimeField from './DateTimeField';
import PhotoMenu from './PhotoMenu';
import { Button, FieldLabel, Segmented, TextField } from './ui';

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
}: {
  initial?: Child;
  submitLabel: string;
  onSubmit: (input: ChildInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? toIsoDate(Date.now()));
  const [dueDate, setDueDate] = useState<string | null>(initial?.dueDate ?? null);
  const [sex, setSex] = useState<Child['sex']>(initial?.sex ?? null);
  const [photoUri, setPhotoUri] = useState<string | null>(initial?.photoUri ?? null);
  const [menu, setMenu] = useState(false);

  return (
    <View>
      <Pressable onPress={() => setMenu(true)} className="items-center mt-2 mb-2">
        <ChildAvatar child={{ id: initial?.id ?? 'new', name: name || '?', photoUri }} size={96} />
        <View className="flex-row items-center mt-2">
          <Camera color="#a78bfa" size={14} />
          <Text className="text-violet-300 text-sm ml-1.5">{photoUri ? 'Change photo' : 'Add a photo'}</Text>
        </View>
      </Pressable>
      <PhotoMenu visible={menu} hasPhoto={photoUri !== null} onClose={() => setMenu(false)} onChange={setPhotoUri} />

      <FieldLabel>Name</FieldLabel>
      <TextField value={name} onChangeText={setName} placeholder="Baby's name" autoFocus={!initial} />

      <FieldLabel>Birth date</FieldLabel>
      <DateTimeField
        mode="date"
        value={fromIsoDate(birthDate)}
        maximumDate={new Date()}
        onChange={(ms) => setBirthDate(toIsoDate(ms))}
      />

      <FieldLabel>Sex (for growth percentiles)</FieldLabel>
      <Segmented options={SEX_OPTIONS} value={sex} onChange={setSex} />

      <View className="flex-row items-center justify-between mt-4">
        <Text className="text-slate-300 text-sm flex-1">Born early? Use due date for corrected age</Text>
        <Switch value={dueDate !== null} onValueChange={(on) => setDueDate(on ? birthDate : null)} />
      </View>
      {dueDate !== null ? (
        <>
          <FieldLabel>Due date</FieldLabel>
          <DateTimeField mode="date" value={fromIsoDate(dueDate)} onChange={(ms) => setDueDate(toIsoDate(ms))} />
        </>
      ) : null}

      <Button
        label={submitLabel}
        disabled={name.trim().length === 0}
        onPress={() => onSubmit({ name: name.trim(), birthDate, dueDate, sex, photoUri })}
      />
    </View>
  );
}
