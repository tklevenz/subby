import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { LOG_TYPES, logsToCsv, type LogType } from '@kindred-log/shared';
import PremiumGate from '../components/PremiumGate';
import { TYPE_META } from '../components/logTypes';
import { Button, Chip, FieldLabel, Segmented } from '../components/ui';
import { fetchLogs } from '../store/queries';
import { useActiveChild } from '../store/useActiveChild';
import { countChildLogs } from '../store/useChildStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { toIsoDate } from '../store/timeHelpers';

const RANGES = [
  { value: 'all', label: 'All time' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
] as const;

export default function ExportScreen() {
  const child = useActiveChild();
  const isPremium = useSettingsStore((s) => s.isPremium);
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('all');
  const [counts, setCounts] = useState<Partial<Record<LogType, number>>>({});
  const [selected, setSelected] = useState<Set<LogType> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!child) return;
    countChildLogs(child.id).then((c) => {
      setCounts(c);
      setSelected((s) => s ?? new Set(LOG_TYPES.filter((t) => c[t])));
    });
  }, [child?.id]);

  if (!child) return null;

  if (!isPremium) {
    return (
      <PremiumGate
        title="CSV export is a Premium feature"
        description="Export every entry as a spreadsheet to share with your pediatrician or keep your own backup."
      />
    );
  }

  const types = LOG_TYPES.filter((t) => counts[t]);
  const toggle = (t: LogType) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const exportCsv = async () => {
    if (!selected?.size) return;
    setBusy(true);
    const slug = child.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'child';
    const file = new File(Paths.cache, `kindred-log-${slug}-${toIsoDate(Date.now())}.csv`);
    try {
      const from = range === 'all' ? undefined : Date.now() - Number(range) * 86_400_000;
      const logs = await fetchLogs(child.id, { from, types: [...selected] });
      if (logs.length === 0) {
        Alert.alert('Nothing to export', 'No entries match this range and selection.');
        return;
      }
      if (file.exists) file.delete();
      file.create();
      file.write(logsToCsv(logs, child.name));
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export CSV' });
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      // The share sheet has its own copy by now; don't leave plaintext data in the cache.
      try {
        if (file.exists) file.delete();
      } catch {}
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-ground" contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text className="text-ink-muted leading-6">
        One CSV with {child.name}'s entries, oldest first. Values are in ml, g, cm and °C; times are local.
      </Text>

      <FieldLabel>Range</FieldLabel>
      <Segmented options={RANGES} value={range} onChange={setRange} />

      <FieldLabel>Include</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {types.map((t) => (
          <Chip key={t} label={`${TYPE_META[t].label} · ${counts[t]!.toLocaleString()}`} selected={selected?.has(t) ?? false} onPress={() => toggle(t)} />
        ))}
      </View>
      {types.length === 0 ? <Text className="text-ink-faint mt-2">Nothing logged yet.</Text> : null}

      <Button label={busy ? 'Exporting…' : 'Export CSV'} disabled={busy || !selected?.size} onPress={exportCsv} />
      <Text className="text-ink-ghost text-xs mt-3 leading-5">
        The file isn't encrypted. Whoever you share it with can read it.
      </Text>
    </ScrollView>
  );
}
