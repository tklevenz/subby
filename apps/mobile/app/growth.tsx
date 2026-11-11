import { formatDate, t } from '@subby/shared/i18n';
import { errorMessage } from '../features/errorMessage';
import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
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
} from '@subby/shared';
import GrowthChart, { chartUnitLabel } from '../components/charts/GrowthChart';
import { Button, Segmented } from '../components/ui';
import { useLogQuery } from '../store/queries';
import { useActiveChild } from '../store/useActiveChild';
import { useSettingsStore } from '../store/useSettingsStore';
import { SubMono } from '../components/brand/Sub';
import { colors } from '../theme/colors';
import { ScreenScroll } from '../components/ScreenScroll';
import BottomSheet from '../components/BottomSheet';
import LogSheet from '../components/sheets/LogSheet';
import { TYPE_META } from '../components/logTypes';

const measures = () =>
  [
    { value: 'weightKg', label: t('growth.weight') },
    { value: 'lengthCm', label: t('growth.length') },
    { value: 'headCm', label: t('growth.head') },
  ] as const;

const TITLE_KEYS = { weightKg: 'growth.weightTitle', lengthCm: 'growth.lengthTitle', headCm: 'growth.headTitle' } as const;
const NONE_KEYS = { weightKg: 'growth.noWeight', lengthCm: 'growth.noLength', headCm: 'growth.noHead' } as const;
const title = (measure: GrowthMeasure) => t(TITLE_KEYS[measure]);

const GROWTH = ['growth'] as const;

export default function GrowthScreen() {
  const child = useActiveChild();
  const units = useSettingsStore((s) => s.units);
  const [measure, setMeasure] = useState<GrowthMeasure>('weightKg');
  const logs = useLogQuery({ types: GROWTH });
  const chartRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  // The log sheet lives on Home; this screen has its own, so a measurement goes in without leaving the chart.
  const [adding, setAdding] = useState(false);

  const points = useMemo(() => (logs && child ? growthPoints(logs, child, measure) : []), [logs, child, measure]);
  if (!child) return null;

  const sex = child.sex === 'male' || child.sex === 'female' ? child.sex : null;
  const format = (v: number) => (measure === 'weightKg' ? formatWeight(v * 1000, units) : formatLength(v, units));
  const beyondWho = points.some((p) => p.months > WHO_MAX_MONTHS);

  const share = async () => {
    setSharing(true);
    try {
      const uri = await captureRef(chartRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('growth.shareTitle', { name: child.name, chart: title(measure) }) });
    } catch (e) {
      Alert.alert(t('growth.shareFailed'), errorMessage(e));
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScreenScroll>
      <Segmented options={measures()} value={measure} onChange={setMeasure} />

      {!sex ? (
        <Pressable onPress={() => router.push(`/child/${child.id}/edit`)} className="mt-4 rounded-xl border border-amber/40 bg-amber/10 p-3">
          <Text className="text-amber-pale text-sm leading-5">
            {t('growth.setSex', { name: child.name })}
          </Text>
        </Pressable>
      ) : null}

      {/* Captured as the shared image, so it carries its own title. */}
      <View ref={chartRef} collapsable={false} className="mt-4 bg-ground py-3">
        <Text className="text-ink font-semibold text-base">{t('growth.chartTitle', { name: child.name, chart: title(measure) })}</Text>
        <Text className="text-ink-faint text-xs mb-3">
          {t(sex === 'female' ? 'growth.byAgeGirls' : sex ? 'growth.byAgeBoys' : 'growth.byAge', { unit: chartUnitLabel(measure, units) })}
        </Text>
        <GrowthChart measure={measure} sex={sex} points={points} units={units} />
        <View className="flex-row items-center mt-2">
          <Text className="text-ink-ghost text-[10px]">{t('growth.source')}</Text>
          <SubMono width={14} color={colors.inkFaint} />
          <Text className="text-ink-faint text-[10px] ml-1">Subby</Text>
        </View>
      </View>

      {points.length === 0 && logs ? (
        <Text className="text-ink-faint text-center mt-4">{t(NONE_KEYS[measure])}</Text>
      ) : null}
      {beyondWho ? <Text className="text-ink-faint text-xs mt-2">{t('growth.beyondWho')}</Text> : null}

      <Button label={t('growth.add')} onPress={() => setAdding(true)} />

      {points.length > 0 ? (
        <>
          <Button label={t(sharing ? 'growth.preparing' : 'growth.share')} variant="ghost" disabled={sharing} onPress={share} />
          <View className="mt-6 bg-surface border border-line rounded-2xl">
            {[...points].reverse().map((p) => {
              const pct = growthPercentile(measure, child.sex, p.months, p.value);
              return (
                <Pressable key={p.id} onPress={() => router.push(`/entry/${p.id}`)} className="flex-row items-center px-4 py-3 border-b border-line">
                  <View className="flex-1">
                    <Text className="text-ink">{format(p.value)}</Text>
                    <Text className="text-ink-faint text-xs">
                      {t('growth.pointDate', { date: formatDate(p.at, { day: 'numeric', month: 'short', year: 'numeric' }), age: formatAge(child.birthDate, p.at) })}
                    </Text>
                  </View>
                  {pct !== null ? <Text className="text-violet-pale text-sm">{formatPercentile(pct)}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <BottomSheet
        visible={adding}
        onClose={() => setAdding(false)}
        title={t('sheet.log.growth')}
        icon={<GrowthIcon color={TYPE_META.growth.color} size={20} />}
      >
        {adding ? <LogSheet type="growth" onClose={() => setAdding(false)} /> : null}
      </BottomSheet>
    </ScreenScroll>
  );
}

function GrowthIcon(props: { color: string; size: number }) {
  const { Icon } = TYPE_META.growth;
  return <Icon {...props} />;
}
