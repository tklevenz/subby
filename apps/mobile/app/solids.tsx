import { formatDate, t } from '@subby/shared/i18n';
import React, { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { solidsReport } from '@subby/shared';
import { Segmented } from '../components/ui';
import { HAS_FOODS, useLogQuery } from '../store/queries';
import { useScreenBottom } from '../components/ScreenScroll';

const filters = () =>
  [
    { value: 'all', label: t('solids.all') },
    { value: 'flagged', label: t('solids.flagged') },
  ] as const;

const FEEDS = ['feed'] as const;

export default function SolidsScreen() {
  const bottom = useScreenBottom();
  const logs = useLogQuery({ types: FEEDS, where: HAS_FOODS });
  const [filter, setFilter] = useState<ReturnType<typeof filters>[number]['value']>('all');
  const foods = useMemo(() => (logs ? solidsReport(logs) : []), [logs]);
  const flagged = foods.filter((f) => f.allergen || f.reactions.length > 0);
  const shown = filter === 'all' ? foods : flagged;
  const fmt = (ms: number) => formatDate(ms, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <FlatList
      className="flex-1 bg-ground"
      contentContainerStyle={{ padding: 16, paddingBottom: bottom }}
      data={logs ? shown : []}
      keyExtractor={(f) => f.name.toLowerCase()}
      ListHeaderComponent={
        <View className="mb-3">
          <View className="flex-row gap-2 mb-4">
            <Stat label={t('solids.tried')} value={foods.length} />
            <Stat label={t('solids.flaggedCount')} value={flagged.length} />
          </View>
          <Segmented options={filters()} value={filter} onChange={setFilter} />
        </View>
      }
      ListEmptyComponent={
        logs ? (
          <Text className="text-ink-faint text-center mt-6 leading-6">
            {t(filter === 'all' ? 'solids.noFoods' : 'solids.noFlagged')}
          </Text>
        ) : null
      }
      renderItem={({ item: f }) => (
        <View className="bg-surface border border-line rounded-xl px-4 py-3 mb-2">
          <View className="flex-row items-center">
            <Text className="flex-1 text-ink text-base">{f.name}</Text>
            {f.allergen ? (
              <Text className="text-red-pale text-[11px] bg-red/20 border border-red/40 rounded-full px-2 py-0.5 overflow-hidden">{t('solids.allergen')}</Text>
            ) : null}
          </View>
          <Text className="text-ink-faint text-xs mt-1">
            {f.count > 1
              ? t('solids.firstLast', { count: f.count, first: fmt(f.firstAt), last: fmt(f.lastAt) })
              : t('solids.firstOnly', { count: f.count, first: fmt(f.firstAt) })}
          </Text>
          {f.reactions.length ? <Text className="text-amber-pale text-xs mt-1">{t('solids.reaction', { reactions: f.reactions.join(t('solids.reactionsJoin')) })}</Text> : null}
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
