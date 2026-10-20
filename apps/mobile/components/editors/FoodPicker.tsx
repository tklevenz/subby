import React, { useMemo, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Plus, TriangleAlert } from 'lucide-react-native';
import { flaggedFoods, recentFoods, type PayloadOf } from '@kindred-log/shared';
import { HAS_FOODS, useLogQuery } from '../../store/queries';
import { Chip, FieldLabel, TextField } from '../ui';
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
  const has = (f: string) => foods.some((x) => x.toLowerCase() === f.toLowerCase());
  const options = [...foods, ...recentFoods(logs, 20).filter((f) => !has(f))];

  const toggle = (f: string) =>
    onChange({ foods: has(f) ? foods.filter((x) => x.toLowerCase() !== f.toLowerCase()) : [...foods, f] });
  const add = () => {
    const f = draft.trim();
    if (f && !has(f)) onChange({ foods: [...foods, f] });
    setDraft('');
  };

  return (
    <View>
      <FieldLabel>Foods</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {options.map((f) => (
          <Chip key={f} label={flagged.has(f.toLowerCase()) ? `⚠︎ ${f}` : f} selected={has(f)} onPress={() => toggle(f)} />
        ))}
      </View>
      <View className="flex-row items-center mt-2">
        <TextField className="flex-1" value={draft} onChangeText={setDraft} placeholder="New food" onSubmitEditing={add} returnKeyType="done" />
        <Pressable onPress={add} className="ml-2 p-3 rounded-xl bg-raised" hitSlop={6}>
          <Plus color={colors.inkSoft} size={18} />
        </Pressable>
      </View>

      <View className="flex-row items-center justify-between mt-4">
        <View className="flex-row items-center">
          <TriangleAlert color={colors.amberStrong} size={16} />
          <Text className="text-ink-soft ml-2">Possible allergen / first try</Text>
        </View>
        <Switch value={value.allergen ?? false} onValueChange={(allergen) => onChange({ allergen: allergen || undefined })} />
      </View>

      <FieldLabel>Reaction</FieldLabel>
      <TextField
        value={value.reaction ?? ''}
        onChangeText={(reaction) => onChange({ reaction: reaction || undefined })}
        placeholder="e.g. loved it, rash, refused"
      />
    </View>
  );
}
