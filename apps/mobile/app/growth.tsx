import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import {
  WHO_MAX_MONTHS,
  formatAge,
  formatLength,
  formatPercentile,
  formatWeight,
  growthPercentile,
  growthPoints,
  type GrowthMeasure,
} from '@kindred-log/shared';
import GrowthChart, { chartUnitLabel } from '../components/charts/GrowthChart';
import { Button, Segmented } from '../components/ui';
import { useLogQuery } from '../store/queries';
import { useActiveChild } from '../store/useActiveChild';
import { useSettingsStore } from '../store/useSettingsStore';

const MEASURES = [
  { value: 'weightKg', label: 'Weight' },
  { value: 'lengthCm', label: 'Length' },
  { value: 'headCm', label: 'Head' },
] as const;

const TITLES: Record<GrowthMeasure, string> = {
  weightKg: 'Weight-for-age',
  lengthCm: 'Length-for-age',
  headCm: 'Head circumference-for-age',
};

const GROWTH = ['growth'] as const;

export default function GrowthScreen() {
  const child = useActiveChild();
  const units = useSettingsStore((s) => s.units);
  const [measure, setMeasure] = useState<GrowthMeasure>('weightKg');
  const logs = useLogQuery({ types: GROWTH });
  const chartRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  const points = useMemo(() => (logs && child ? growthPoints(logs, child, measure) : []), [logs, child, measure]);
  if (!child) return null;

  const sex = child.sex === 'male' || child.sex === 'female' ? child.sex : null;
  const format = (v: number) => (measure === 'weightKg' ? formatWeight(v * 1000, units) : formatLength(v, units));
  const beyondWho = points.some((p) => p.months > WHO_MAX_MONTHS);

  const share = async () => {
    setSharing(true);
    try {
      const uri = await captureRef(chartRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `${child.name} – ${TITLES[measure]}` });
    } catch (e) {
      Alert.alert('Could not share chart', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Segmented options={MEASURES} value={measure} onChange={setMeasure} />

      {!sex ? (
        <Pressable onPress={() => router.push(`/child/${child.id}/edit`)} className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <Text className="text-amber-200 text-sm leading-5">
            WHO percentiles differ for girls and boys. Set it in {child.name}'s profile to see them. Tap to edit.
          </Text>
        </Pressable>
      ) : null}

      {/* Captured as the shared image, so it carries its own title. */}
      <View ref={chartRef} collapsable={false} className="mt-4 bg-slate-950 py-3">
        <Text className="text-white font-semibold text-base">{child.name} · {TITLES[measure]}</Text>
        <Text className="text-slate-500 text-xs mb-3">
          {chartUnitLabel(measure, units)} by age in months
          {sex ? ` · WHO ${sex === 'female' ? 'girls' : 'boys'} 3rd–97th percentile` : ''}
        </Text>
        <GrowthChart measure={measure} sex={sex} points={points} units={units} />
        <Text className="text-slate-600 text-[10px] mt-2">Source: WHO Child Growth Standards · Kindred Log</Text>
      </View>

      {points.length === 0 && logs ? (
        <Text className="text-slate-500 text-center mt-4">No {MEASURES.find((m) => m.value === measure)!.label.toLowerCase()} measurements yet. Log one from Home → More → Growth.</Text>
      ) : null}
      {beyondWho ? <Text className="text-slate-500 text-xs mt-2">WHO percentiles here cover 0–24 months.</Text> : null}

      {points.length > 0 ? (
        <>
          <Button label={sharing ? 'Preparing…' : 'Share chart'} variant="ghost" disabled={sharing} onPress={share} />
          <View className="mt-6 bg-slate-900 border border-slate-800 rounded-2xl">
            {[...points].reverse().map((p) => {
              const pct = growthPercentile(measure, child.sex, p.months, p.value);
              return (
                <Pressable key={p.id} onPress={() => router.push(`/entry/${p.id}`)} className="flex-row items-center px-4 py-3 border-b border-slate-800">
                  <View className="flex-1">
                    <Text className="text-white">{format(p.value)}</Text>
                    <Text className="text-slate-500 text-xs">
                      {new Date(p.at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} · {formatAge(child.birthDate, p.at)}
                    </Text>
                  </View>
                  {pct !== null ? <Text className="text-violet-200 text-sm">{formatPercentile(pct)}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
