import React, { useState } from 'react';
import { View, Switch, Text } from 'react-native';
import type { Child } from '@kindred-log/shared';
import type { ChildInput } from '../store/useChildStore';
import { fromIsoDate, toIsoDate } from '../store/timeHelpers';
import DateTimeField from './DateTimeField';
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

  return (
    <View>
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
        onPress={() => onSubmit({ name: name.trim(), birthDate, dueDate, sex })}
      />
    </View>
  );
}
