import { formatNumber, t, type MessageKey } from '@subby/shared/i18n';
import { errorMessage } from '../../features/errorMessage';
import React, { useMemo, useRef, useState } from 'react';
import { ScreenScroll } from '../../components/ScreenScroll';
import { Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BB_ENDPOINTS,
  bbRef,
  formatLength,
  formatTemperature,
  formatVolume,
  formatWeight,
  mapRecord,
  type BBChild,
  type BBEndpoint,
  type ImportUnits,
} from '@subby/shared';
import { Button, Card, FieldLabel, Row, Segmented, TextField, ErrorText, WarningText, Lead } from '../../components/ui';
import { BBClient, BBError } from '../../features/import/babybuddy/client';
import { previewImport, runImport, type ImportPreview, type ImportProgress, type ImportResult } from '../../features/import/babybuddy/importer';
import { useChildStore } from '../../store/useChildStore';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SubLoader, SubProgress, SubSpinner } from '../../components/brand/loaders';

const LABEL_KEYS = {
  feedings: 'bb.feedings', changes: 'bb.changes', sleep: 'bb.sleep', 'tummy-times': 'bb.tummy',
  pumping: 'bb.pumping', temperature: 'bb.temperature', weight: 'bb.weight', height: 'bb.height',
  'head-circumference': 'bb.head', medication: 'bb.medication', notes: 'bb.notes',
} as const satisfies Record<BBEndpoint, MessageKey>;
const label = (e: BBEndpoint) => t(LABEL_KEYS[e]);

const NEW = 'new';
const SKIP = 'skip';

type Step =
  | { kind: 'connect' }
  | { kind: 'review'; client: BBClient; preview: ImportPreview }
  | { kind: 'running'; progress: ImportProgress | null }
  | { kind: 'done'; result: ImportResult };

/** Show what a raw sample value becomes under the chosen unit, e.g. "14260 → 14.26 kg". */
function unitExample(measure: keyof ImportUnits, raw: number | undefined, units: ImportUnits, display: 'metric' | 'imperial') {
  if (raw === undefined) return t('bb.noData');
  const host = 'preview';
  const map = (e: BBEndpoint, r: object) => mapRecord(e, { id: 0, child: null, ...r } as never, host, units).payload;
  switch (measure) {
    case 'volume': {
      const p = map('pumping', { start: '2000-01-01T00:00:00Z', end: '2000-01-01T00:00:00Z', amount: raw });
      return p.type === 'pumping' && p.amountMl !== undefined ? t('bb.example', { raw: String(raw), value: formatVolume(p.amountMl, display) }) : '';
    }
    case 'weight': {
      const p = map('weight', { date: '2000-01-01', weight: raw });
      return p.type === 'growth' && p.weightG !== undefined ? t('bb.example', { raw: String(raw), value: formatWeight(p.weightG, display) }) : '';
    }
    case 'length': {
      const p = map('height', { date: '2000-01-01', height: raw });
      return p.type === 'growth' && p.heightCm !== undefined ? t('bb.example', { raw: String(raw), value: formatLength(p.heightCm, display) }) : '';
    }
    case 'temperature': {
      const p = map('temperature', { time: '2000-01-01T00:00:00Z', temperature: raw });
      return p.type === 'temperature' ? t('bb.example', { raw: String(raw), value: formatTemperature(p.celsius, display) }) : '';
    }
  }
}

const UNIT_OPTIONS: { [K in keyof ImportUnits]: { value: ImportUnits[K]; label: string }[] } = {
  volume: [{ value: 'ml', label: 'ml' }, { value: 'oz', label: 'oz' }],
  weight: [{ value: 'g', label: 'g' }, { value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }, { value: 'oz', label: 'oz' }],
  length: [{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }],
  temperature: [{ value: 'c', label: '°C' }, { value: 'f', label: '°F' }],
};

export default function BabyBuddyImport() {
  const settings = useSettingsStore();
  const [step, setStep] = useState<Step>({ kind: 'connect' });
  const [url, setUrl] = useState(settings.bbUrl ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const client = new BBClient(url, token);
      const preview = await previewImport(client, settings.units);
      await settings.set('bbUrl', client.baseUrl);
      setStep({ kind: 'review', client, preview });
    } catch (e) {
      setError(e instanceof BBError ? e.message : t('bb.unexpected', { error: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('bb.title'), headerShown: true, gestureEnabled: step.kind !== 'running' }} />

      {step.kind === 'connect' ? (
        <View>
          <Lead>
            {t('bb.lead')}
          </Lead>
          <FieldLabel>{t('bb.server')}</FieldLabel>
          <TextField value={url} onChangeText={setUrl} placeholder="https://babybuddy.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <FieldLabel>{t('bb.apiKey')}</FieldLabel>
          <TextField value={token} onChangeText={setToken} placeholder={t('bb.apiKeyPlaceholder')} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Text className="text-ink-faint text-xs mt-2">{t('bb.notSaved')}</Text>
          {url.trim().toLowerCase().startsWith('http://') ? (
            <Text className="text-amber-soft text-xs mt-2">{t('bb.http')}</Text>
          ) : null}
          {error ? <ErrorText className="mt-3">{error}</ErrorText> : null}
          {busy ? <View className="items-center mt-4"><SubSpinner size={36} /></View> : (
            <Button label={t('bb.connect')} onPress={connect} disabled={!url.trim() || !token.trim()} />
          )}
        </View>
      ) : null}

      {step.kind === 'review' ? (
        <Review
          client={step.client}
          preview={step.preview}
          onStart={async (units, childMap, fallbackChildId) => {
            cancelled.current = false;
            setStep({ kind: 'running', progress: null });
            try {
              const result = await runImport({
                client: step.client,
                units,
                counts: step.preview.counts,
                childMap,
                fallbackChildId,
                onProgress: (progress) => setStep({ kind: 'running', progress }),
                isCancelled: () => cancelled.current,
              });
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setStep({ kind: 'done', result });
            } catch (e) {
              setStep({ kind: 'done', result: { imported: 0, skipped: 0, excluded: 0, cancelled: false, failed: [{ ref: 'import', reason: errorMessage(e) }] } });
            } finally {
              await useChildStore.getState().hydrate();
              const active = useSettingsStore.getState().activeChildId;
              if (active) await useLogStore.getState().loadLogs(active);
            }
          }}
        />
      ) : null}

      {step.kind === 'running' ? (
        <View className="items-center mt-8">
          {step.progress ? (
            <>
              <Text className="text-ink text-base mt-4">{label(step.progress.endpoint)}</Text>
              <Text className="text-ink-muted mt-1">{t('bb.progress', { done: step.progress.done, total: step.progress.total })}</Text>
              <View className="w-full mt-3">
                <SubProgress progress={step.progress.done / Math.max(1, step.progress.total)} />
              </View>
              <Text className="text-ink-faint text-xs mt-2">
                {t('bb.step', { n: BB_ENDPOINTS.indexOf(step.progress.endpoint) + 1, total: BB_ENDPOINTS.length })}
              </Text>
            </>
          ) : (
            <>
              <SubLoader />
              <Text className="text-ink-muted mt-4">{t('bb.starting')}</Text>
            </>
          )}
          <View className="w-full">
            <Button label={t('common.cancel')} variant="ghost" onPress={() => (cancelled.current = true)} />
          </View>
          <Text className="text-ink-faint text-xs mt-2 text-center">{t('bb.keepGoing')}</Text>
        </View>
      ) : null}

      {step.kind === 'done' ? (
        <View>
          <Text className="text-xl font-bold text-ink">{t(step.result.cancelled ? 'bb.cancelled' : 'bb.finished')}</Text>
          <Card>
            <Row label={t('bb.imported')} value={formatNumber(step.result.imported)} />
            <Row label={t('bb.skipped')} value={formatNumber(step.result.skipped)} />
            {step.result.excluded ? <Row label={t('bb.excluded')} value={formatNumber(step.result.excluded)} /> : null}
            <Row label={t('bb.failed')} value={formatNumber(step.result.failed.length)} />
          </Card>
          {step.result.failed.slice(0, 5).map((f) => (
            <Text key={f.ref} className="text-red-soft text-xs mt-2">{t('bb.failure', { ref: f.ref, reason: f.reason })}</Text>
          ))}
          <Text className="text-ink-muted mt-4 leading-5">
            {t('bb.regenerate')}
          </Text>
          <Button label={t('common.done')} onPress={() => router.replace('/')} />
        </View>
      ) : null}
    </ScreenScroll>
  );
}

function Review({
  client,
  preview,
  onStart,
}: {
  client: BBClient;
  preview: ImportPreview;
  onStart: (units: ImportUnits, childMap: Map<number, string | null>, fallbackChildId: string) => void;
}) {
  const localChildren = useChildStore((s) => s.children);
  const { addChild, updateChild } = useChildStore.getState();
  const settings = useSettingsStore();
  const [units, setUnits] = useState(preview.units);
  const total = BB_ENDPOINTS.reduce((n, e) => n + preview.counts[e], 0);

  // Default mapping: previously imported child → same child; else same birth date; else new.
  const [mapping, setMapping] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      preview.children.map((bb) => {
        const ref = bbRef(client.host, 'children', bb.id);
        const match = localChildren.find((k) => k.importRef === ref) ?? localChildren.find((k) => k.birthDate === bb.birth_date);
        return [bb.id, match ? match.id : NEW];
      }),
    ),
  );

  const allSkipped = preview.children.length > 0 && preview.children.every((bb) => mapping[bb.id] === SKIP);

  const childOptions = useMemo(
    () => [
      { value: NEW, label: t('bb.newChild') },
      ...localChildren.map((k) => ({ value: k.id, label: k.name })),
      { value: SKIP, label: t('bb.dontImport') },
    ],
    [localChildren],
  );

  const start = async () => {
    // Resolve mapping: create new children, tag matched ones with their BB ref for future re-runs.
    const childMap = new Map<number, string | null>();
    for (const bb of preview.children) {
      const ref = bbRef(client.host, 'children', bb.id);
      const target = mapping[bb.id];
      if (target === SKIP) {
        childMap.set(bb.id, null);
      } else if (target === NEW) {
        const child = await addChild(bbChildInput(bb, ref));
        childMap.set(bb.id, child.id);
      } else {
        const existing = localChildren.find((k) => k.id === target);
        if (existing && existing.importRef !== ref) await updateChild(target, { importRef: ref });
        childMap.set(bb.id, target);
      }
    }
    const fallback = [...childMap.values()].find((id) => id !== null) ?? localChildren[0]?.id;
    if (!fallback) return;
    if (!settings.activeChildId) await settings.set('activeChildId', fallback);
    onStart(units, childMap, fallback);
  };

  return (
    <View>
      <Text className="text-ink text-lg font-semibold">{t('bb.found', { count: total })}</Text>
      <Card>
        {BB_ENDPOINTS.filter((e) => preview.counts[e] > 0).map((e) => (
          <Row key={e} label={label(e)} value={formatNumber(preview.counts[e])} />
        ))}
      </Card>

      <FieldLabel>{t('bb.children')}</FieldLabel>
      {preview.children.map((bb) => (
        <View key={bb.id} className="mb-3">
          <Text className="text-ink-light mb-2">{bb.first_name} {bb.last_name} · born {bb.birth_date} → import into</Text>
          <Segmented options={childOptions} value={mapping[bb.id]} onChange={(v) => setMapping((m) => ({ ...m, [bb.id]: v }))} />
        </View>
      ))}

      <FieldLabel>{t('bb.units')}</FieldLabel>
      {(Object.keys(UNIT_OPTIONS) as (keyof ImportUnits)[]).map((measure) => (
        <View key={measure} className="mb-3">
          <Text className="text-ink-soft mb-1.5">
            {t(`bb.measure.${measure}`)} <Text className="text-ink-faint">· {unitExample(measure, preview.examples[measure], units, settings.units)}</Text>
          </Text>
          <Segmented
            options={UNIT_OPTIONS[measure] as { value: string; label: string }[]}
            value={units[measure]}
            onChange={(v) => setUnits((u) => ({ ...u, [measure]: v }))}
          />
        </View>
      ))}

      <Button label={t('bb.importN', { count: total })} onPress={start} disabled={preview.children.length === 0 || allSkipped} />
      {preview.children.length === 0 ? <WarningText className="mt-2">{t('bb.noChildren')}</WarningText> : null}
    </View>
  );
}

function bbChildInput(bb: BBChild, importRef: string) {
  return {
    name: [bb.first_name, bb.last_name].filter(Boolean).join(' ').trim() || t('bb.baby'),
    birthDate: bb.birth_date,
    birthTime: bb.birth_time ? bb.birth_time.slice(0, 5) : null,
    dueDate: bb.due_date ?? null,
    importRef,
  };
}
