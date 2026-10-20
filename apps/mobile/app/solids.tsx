import React, { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { solidsReport } from '@kindred-log/shared';
import { Segmented } from '../components/ui';
import { HAS_FOODS, useLogQuery } from '../store/queries';

const FILTERS = [
  { value: 'all', label: 'All foods' },
  { value: 'flagged', label: 'Reactions & allergens' },
] as const;

const FEEDS = ['feed'] as const;

export default function SolidsScreen() {
  const logs = useLogQuery({ types: FEEDS, where: HAS_FOODS });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all');
  const foods = useMemo(() => (logs ? solidsReport(logs) : []), [logs]);
  const flagged = foods.filter((f) => f.allergen || f.reactions.length > 0);
  const shown = filter === 'all' ? foods : flagged;
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <FlatList
      className="flex-1 bg-ground"
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      data={logs ? shown : []}
      keyExtractor={(f) => f.name.toLowerCase()}
      ListHeaderComponent={
        <View className="mb-3">
          <View className="flex-row gap-2 mb-4">
            <Stat label="Foods tried" value={foods.length} />
            <Stat label="Flagged" value={flagged.length} />
          </View>
          <Segmented options={FILTERS} value={filter} onChange={setFilter} />
        </View>
      }
      ListEmptyComponent={
        logs ? (
          <Text className="text-ink-faint text-center mt-6 leading-6">
            {filter === 'all' ? 'No foods logged yet. Log solids with foods from the Feed sheet.' : 'No reactions or allergens noted.'}
          </Text>
        ) : null
      }
      renderItem={({ item: f }) => (
        <View className="bg-surface border border-line rounded-xl px-4 py-3 mb-2">
          <View className="flex-row items-center">
            <Text className="flex-1 text-ink text-base">{f.name}</Text>
            {f.allergen ? (
              <Text className="text-red-pale text-[11px] bg-red/20 border border-red/40 rounded-full px-2 py-0.5 overflow-hidden">Allergen</Text>
            ) : null}
          </View>
          <Text className="text-ink-faint text-xs mt-1">
            {f.count}× · first {fmt(f.firstAt)}{f.count > 1 ? ` · last ${fmt(f.lastAt)}` : ''}
          </Text>
          {f.reactions.length ? <Text className="text-amber-pale text-xs mt-1">Reaction: {f.reactions.join('; ')}</Text> : null}
        </View>
      )}
    />
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 bg-surface border border-line rounded-xl p-3">
      <Text className="text-ink-muted text-xs">{label}</Text>
      <Text className="text-ink text-xl font-semibold">{value}</Text>
    </View>
  );
}
