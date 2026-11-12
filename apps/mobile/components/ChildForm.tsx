import { t } from '@subby/shared/i18n';
import { useConfirmDiscard } from './useConfirmDiscard';
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

const sexOptions = () =>
  [
    { value: 'female', label: t('childForm.girl') },
    { value: 'male', label: t('childForm.boy') },
    { value: 'other', label: t('childForm.other') },
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
  const leave = useConfirmDiscard(
    name !== (initial?.name ?? '') || birthDate !== (initial?.birthDate ?? toIsoDate(Date.now())) || sex !== (initial?.sex ?? null) || photoUri !== (initial?.photoUri ?? null),
  );

  return (
    <View>
      <Pressable onPress={() => setMenu(true)} className="items-center mt-2 mb-2">
        <ChildAvatar child={{ id: initial?.id ?? 'new', name: name || '?', photoUri }} size={96} />
        <View className="flex-row items-center mt-2">
          <Camera color={colors.violetStrong} size={14} />
          <Text className="text-violet-soft text-sm ml-1.5">{t(photoUri ? 'childForm.changePhoto' : 'childForm.addPhoto')}</Text>
        </View>
      </Pressable>
      <PhotoMenu visible={menu} hasPhoto={photoUri !== null} onClose={() => setMenu(false)} onChange={setPhotoUri} />

      <FieldLabel>{t('childForm.name')}</FieldLabel>
      <TextField value={name} onChangeText={setName} placeholder={t('childForm.namePlaceholder')} autoFocus={autoFocus} />

      <FieldLabel>{t('childForm.birthDate')}</FieldLabel>
      <DateTimeField
        mode="date"
        title={t('childForm.birthDate')}
        value={fromIsoDate(birthDate)}
        maximumDate={new Date()}
        onChange={(ms) => setBirthDate(toIsoDate(ms))}
      />

      <FieldLabel>{t('childForm.sex')}</FieldLabel>
      <Segmented options={sexOptions()} value={sex} onChange={setSex} />

      <Button
        label={submitLabel}
        disabled={name.trim().length === 0}
        onPress={() => {
          leave();
          onSubmit({ name: name.trim(), birthDate, sex, photoUri });
        }}
      />
    </View>
  );
}
