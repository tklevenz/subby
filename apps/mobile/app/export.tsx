import { t } from '@subby/shared/i18n';
import { errorMessage } from '../features/errorMessage';
import { useAsyncAction } from '../features/useAsyncAction';
import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { LOG_TYPES, logsToCsv, type LogType } from '@subby/shared';
import { TYPE_META } from '../components/logTypes';
import { Button, Chip, FieldLabel, Segmented, Lead } from '../components/ui';
import { fetchLogs } from '../store/queries';
import { useActiveChild } from '../store/useActiveChild';
import { countChildLogs } from '../store/useChildStore';
import { toIsoDate } from '../store/timeHelpers';
import { EmptyState } from '../components/brand/EmptyState';
import { ScreenScroll } from '../components/ScreenScroll';

const ranges = () =>
  [
    { value: 'all', label: t('export.allTime') },
    { value: '30', label: t('export.days', { count: 30 }) },
    { value: '90', label: t('export.days', { count: 90 }) },
    { value: '365', label: t('export.year') },
  ] as const;

export default function ExportScreen() {
  const child = useActiveChild();
  const [range, setRange] = useState<ReturnType<typeof ranges>[number]['value']>('all');
  const [counts, setCounts] = useState<Partial<Record<LogType, number>>>({});
  const [selected, setSelected] = useState<Set<LogType> | null>(null);
  const { run, busy } = useAsyncAction();

  const childId = child?.id;
  useEffect(() => {
    if (!childId) return;
    void countChildLogs(childId).then((c) => {
      setCounts(c);
      setSelected((s) => s ?? new Set(LOG_TYPES.filter((type) => c[type])));
    });
  }, [childId]);

  if (!child) return null;

  const types = LOG_TYPES.filter((type) => counts[type]);
  const toggle = (type: LogType) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const exportCsv = () => {
    if (!selected?.size) return Promise.resolve(false);
    const slug = child.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'child';
    const file = new File(Paths.cache, `subby-${slug}-${toIsoDate(Date.now())}.csv`);
    return run(
      async () => {
        try {
          const from = range === 'all' ? undefined : Date.now() - Number(range) * 86_400_000;
          const logs = await fetchLogs(child.id, { from, types: [...selected] });
          if (logs.length === 0) {
            Alert.alert(t('export.nothingTitle'), t('export.nothingText'));
            return;
          }
          if (file.exists) file.delete();
          file.create();
          file.write(logsToCsv(logs, child.name));
          await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: t('export.dialog') });
        } finally {
          // The share sheet has its own copy by now; don't leave plaintext data in the cache.
          try {
            if (file.exists) file.delete();
          } catch {}
        }
      },
      (e) => Alert.alert(t('export.failed'), errorMessage(e)),
    );
  };

  return (
    <ScreenScroll>
      <Lead>
        {t('export.lead', { name: child.name })}
      </Lead>

      <FieldLabel>{t('export.range')}</FieldLabel>
      <Segmented options={ranges()} value={range} onChange={setRange} />

      <FieldLabel>{t('export.include')}</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {types.map((type) => (
          <Chip key={type} label={t('export.chip', { type: TYPE_META[type].label, count: counts[type]! })} selected={selected?.has(type) ?? false} onPress={() => toggle(type)} />
        ))}
      </View>
      {types.length === 0 ? <EmptyState small text={t('export.empty')} /> : null}

      <Button label={t(busy ? 'export.exporting' : 'export.button')} disabled={busy || !selected?.size} onPress={exportCsv} />
      <Text className="text-ink-ghost text-xs mt-3 leading-5">
        {t('export.notEncrypted')}
      </Text>
    </ScreenScroll>
  );
}
