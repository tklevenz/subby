import { t } from '@subby/shared/i18n';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Plus, TriangleExclamation } from '../icons';
import { flaggedFoods, recentFoods, sameName, type PayloadOf } from '@subby/shared';
import { HAS_FOODS, useLogQuery } from '../../store/queries';
import { Chip, FieldLabel, TextField, Toggle } from '../ui';
import { colors } from '../../theme/colors';

type Solids = Pick<PayloadOf<'feed'>, 'foods' | 'allergen' | 'reaction'>;

const FEEDS = ['feed'] as const;

/** Food chips (recent foods + new), allergen flag and reaction note for a solids feed. */
export default function FoodPicker({ value, onChange }: { value: Solids; onChange: (patch: Solids) => void }) {
  // All-time, newest first: an allergen flagged months ago must still warn.
  const rows = useLogQuery({ types: FEEDS, where: HAS_FOODS });
  const logs = useMemo(() => (rows ? [...rows].reverse() : []), [rows]);
  const [draft, setDraft] = useState('');
  const foods = value.foods ?? [];
  const flagged = new Set(flaggedFoods(logs).map((f) => f.toLowerCase()));
  const has = (f: string) => foods.some((x) => sameName(x, f));
  const options = [...foods, ...recentFoods(logs, 20).filter((f) => !has(f))];

  const toggle = (f: string) =>
    onChange({ foods: has(f) ? foods.filter((x) => !sameName(x, f)) : [...foods, f] });
  const add = () => {
    const f = draft.trim();
    if (f && !has(f)) onChange({ foods: [...foods, f] });
    setDraft('');
  };

  return (
    <View>
      <FieldLabel>{t('foods.title')}</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {options.map((f) => (
          <Chip
            key={f}
            label={f}
            icon={flagged.has(f.toLowerCase()) ? <TriangleExclamation color={colors.amberStrong} size={13} /> : undefined}
            selected={has(f)}
            onPress={() => toggle(f)}
          />
        ))}
      </View>
      <View className="flex-row items-center mt-2">
        <TextField className="flex-1" value={draft} onChangeText={setDraft} placeholder={t('foods.new')} onSubmitEditing={add} returnKeyType="done" />
        <Pressable onPress={add} className="ml-2 p-3 rounded-xl bg-raised" hitSlop={6}>
          <Plus color={colors.inkSoft} size={18} />
        </Pressable>
      </View>

      <View className="flex-row items-center justify-between mt-4">
        <View className="flex-row items-center">
          <TriangleExclamation color={colors.amberStrong} size={16} />
          <Text className="text-ink-soft ml-2">{t('foods.allergen')}</Text>
        </View>
        <Toggle value={value.allergen ?? false} onValueChange={(allergen) => onChange({ allergen: allergen || undefined })} />
      </View>

      <FieldLabel>{t('foods.reaction')}</FieldLabel>
      <TextField
        value={value.reaction ?? ''}
        onChangeText={(reaction) => onChange({ reaction: reaction || undefined })}
        placeholder={t('foods.reactionPlaceholder')}
      />
    </View>
  );
}
