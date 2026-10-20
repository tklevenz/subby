import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
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
} from '@kindred-log/shared';
import { Button, Card, FieldLabel, Row, Segmented, TextField } from '../../components/ui';
import { BBClient, BBError } from '../../features/import/babybuddy/client';
import { previewImport, runImport, type ImportPreview, type ImportProgress, type ImportResult } from '../../features/import/babybuddy/importer';
import { canAddChild, useChildStore } from '../../store/useChildStore';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';

const LABELS: Record<BBEndpoint, string> = {
  feedings: 'Feedings', changes: 'Diaper changes', sleep: 'Sleep', 'tummy-times': 'Tummy time',
  pumping: 'Pumping', temperature: 'Temperature', weight: 'Weight', height: 'Height',
  'head-circumference': 'Head circumference', medication: 'Medication', notes: 'Notes',
};

const NEW = 'new';
const SKIP = 'skip';

type Step =
  | { kind: 'connect' }
  | { kind: 'review'; client: BBClient; preview: ImportPreview }
  | { kind: 'running'; progress: ImportProgress | null }
  | { kind: 'done'; result: ImportResult };

/** Show what a raw sample value becomes under the chosen unit, e.g. "14260 → 14.26 kg". */
function unitExample(measure: keyof ImportUnits, raw: number | undefined, units: ImportUnits, display: 'metric' | 'imperial') {
  if (raw === undefined) return 'no data';
  const host = 'preview';
  const map = (e: BBEndpoint, r: object) => mapRecord(e, { id: 0, child: null, ...r } as never, host, units).payload;
  switch (measure) {
    case 'volume': {
      const p = map('pumping', { start: '2000-01-01T00:00:00Z', end: '2000-01-01T00:00:00Z', amount: raw });
      return p.type === 'pumping' && p.amountMl !== undefined ? `${raw} → ${formatVolume(p.amountMl, display)}` : '';
    }
    case 'weight': {
      const p = map('weight', { date: '2000-01-01', weight: raw });
      return p.type === 'growth' && p.weightG !== undefined ? `${raw} → ${formatWeight(p.weightG, display)}` : '';
    }
    case 'length': {
      const p = map('height', { date: '2000-01-01', height: raw });
      return p.type === 'growth' && p.heightCm !== undefined ? `${raw} → ${formatLength(p.heightCm, display)}` : '';
    }
    case 'temperature': {
      const p = map('temperature', { time: '2000-01-01T00:00:00Z', temperature: raw });
      return p.type === 'temperature' ? `${raw} → ${formatTemperature(p.celsius, display)}` : '';
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
      setError(e instanceof BBError ? e.message : `Unexpected error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Import from Baby Buddy', headerShown: true, gestureEnabled: step.kind !== 'running' }} />

      {step.kind === 'connect' ? (
        <View>
          <Text className="text-slate-300 leading-6">
            Copies your history from a Baby Buddy server onto this device. It only reads from Baby Buddy, and you can run
            it again later to pick up new entries without creating duplicates.
          </Text>
          <FieldLabel>Server address</FieldLabel>
          <TextField value={url} onChangeText={setUrl} placeholder="https://babybuddy.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <FieldLabel>API key (Baby Buddy → User Settings)</FieldLabel>
          <TextField value={token} onChangeText={setToken} placeholder="API key" autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Text className="text-slate-500 text-xs mt-2">The key is used for this import only and is not saved.</Text>
          {url.trim().toLowerCase().startsWith('http://') ? (
            <Text className="text-amber-300 text-xs mt-2">This address isn't encrypted (http). Your key and data travel in plain text.</Text>
          ) : null}
          {error ? <Text className="text-red-400 mt-3">{error}</Text> : null}
          {busy ? <ActivityIndicator className="mt-4" color="#a78bfa" /> : (
            <Button label="Connect" onPress={connect} disabled={!url.trim() || !token.trim()} />
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
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setStep({ kind: 'done', result });
            } catch (e) {
              setStep({ kind: 'done', result: { imported: 0, skipped: 0, excluded: 0, cancelled: false, failed: [{ ref: 'import', reason: e instanceof Error ? e.message : String(e) }] } });
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
          <ActivityIndicator size="large" color="#a78bfa" />
          {step.progress ? (
            <>
              <Text className="text-white text-base mt-4">{LABELS[step.progress.endpoint]}</Text>
              <Text className="text-slate-400 mt-1">{step.progress.done} / {step.progress.total}</Text>
              <View className="w-full h-2 bg-slate-800 rounded-full mt-3 overflow-hidden">
                <View className="h-2 bg-violet-500" style={{ width: `${Math.round((step.progress.done / Math.max(1, step.progress.total)) * 100)}%` }} />
              </View>
              <Text className="text-slate-500 text-xs mt-2">
                Step {BB_ENDPOINTS.indexOf(step.progress.endpoint) + 1} of {BB_ENDPOINTS.length}
              </Text>
            </>
          ) : <Text className="text-slate-400 mt-4">Starting…</Text>}
          <Button label="Cancel" variant="ghost" onPress={() => (cancelled.current = true)} />
          <Text className="text-slate-500 text-xs mt-2 text-center">Already imported entries stay; run the import again to continue.</Text>
        </View>
      ) : null}

      {step.kind === 'done' ? (
        <View>
          <Text className="text-xl font-bold text-white">{step.result.cancelled ? 'Import cancelled' : 'Import finished'}</Text>
          <Card>
            <Row label="Imported" value={String(step.result.imported)} />
            <Row label="Already imported (skipped)" value={String(step.result.skipped)} />
            {step.result.excluded ? <Row label="Left out (children not imported)" value={String(step.result.excluded)} /> : null}
            <Row label="Couldn't import" value={String(step.result.failed.length)} />
          </Card>
          {step.result.failed.slice(0, 5).map((f) => (
            <Text key={f.ref} className="text-red-300 text-xs mt-2">{f.ref}: {f.reason}</Text>
          ))}
          <Text className="text-slate-400 mt-4 leading-5">
            Done with Baby Buddy? Regenerate your API key there (User Settings) so the copied key stops working.
          </Text>
          <Button label="Done" onPress={() => router.replace('/')} />
        </View>
      ) : null}
    </ScrollView>
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
  const kindredChildren = useChildStore((s) => s.children);
  const { addChild, updateChild } = useChildStore.getState();
  const settings = useSettingsStore();
  const [units, setUnits] = useState(preview.units);
  const total = BB_ENDPOINTS.reduce((n, e) => n + preview.counts[e], 0);

  // Default mapping: previously imported child → same child; else same birth date; else new
  // (or "don't import" once the free child limit is reached).
  const [mapping, setMapping] = useState<Record<number, string>>(() => {
    let created = 0;
    return Object.fromEntries(
      preview.children.map((bb) => {
        const ref = bbRef(client.host, 'children', bb.id);
        const match = kindredChildren.find((k) => k.importRef === ref) ?? kindredChildren.find((k) => k.birthDate === bb.birth_date);
        if (match) return [bb.id, match.id];
        if (!canAddChild(kindredChildren.length + created, settings.isPremium)) return [bb.id, SKIP];
        created++;
        return [bb.id, NEW];
      }),
    );
  });

  // Free covers one child: extra Baby Buddy children must go into an existing one.
  const newCount = preview.children.filter((bb) => mapping[bb.id] === NEW).length;
  const allSkipped = preview.children.length > 0 && preview.children.every((bb) => mapping[bb.id] === SKIP);
  const overLimit = newCount > 0 && !canAddChild(kindredChildren.length + newCount - 1, settings.isPremium);

  const childOptions = useMemo(
    () => [
      { value: NEW, label: 'New child' },
      ...kindredChildren.map((k) => ({ value: k.id, label: k.name })),
      { value: SKIP, label: "Don't import" },
    ],
    [kindredChildren],
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
        const existing = kindredChildren.find((k) => k.id === target);
        if (existing && existing.importRef !== ref) await updateChild(target, { importRef: ref });
        childMap.set(bb.id, target);
      }
    }
    const fallback = [...childMap.values()].find((id) => id !== null) ?? kindredChildren[0]?.id;
    if (!fallback) return;
    if (!settings.activeChildId) await settings.set('activeChildId', fallback);
    onStart(units, childMap, fallback);
  };

  return (
    <View>
      <Text className="text-white text-lg font-semibold">Found {total.toLocaleString()} entries</Text>
      <Card>
        {BB_ENDPOINTS.filter((e) => preview.counts[e] > 0).map((e) => (
          <Row key={e} label={LABELS[e]} value={preview.counts[e].toLocaleString()} />
        ))}
      </Card>

      <FieldLabel>Children</FieldLabel>
      {preview.children.map((bb) => (
        <View key={bb.id} className="mb-3">
          <Text className="text-slate-200 mb-2">{bb.first_name} {bb.last_name} · born {bb.birth_date} → import into</Text>
          <Segmented options={childOptions} value={mapping[bb.id]} onChange={(v) => setMapping((m) => ({ ...m, [bb.id]: v }))} />
        </View>
      ))}

      <FieldLabel>Units in Baby Buddy (detected — check the examples)</FieldLabel>
      {(Object.keys(UNIT_OPTIONS) as (keyof ImportUnits)[]).map((measure) => (
        <View key={measure} className="mb-3">
          <Text className="text-slate-300 mb-1.5 capitalize">
            {measure} <Text className="text-slate-500">· {unitExample(measure, preview.examples[measure], units, settings.units)}</Text>
          </Text>
          <Segmented
            options={UNIT_OPTIONS[measure] as { value: string; label: string }[]}
            value={units[measure]}
            onChange={(v) => setUnits((u) => ({ ...u, [measure]: v }))}
          />
        </View>
      ))}

      {overLimit ? (
        <Text className="text-amber-300 mt-2 leading-5">
          The free version tracks one child. Import the others into an existing child, choose "Don't import", or get Premium to add them as their own.
        </Text>
      ) : null}
      <Button label={`Import ${total.toLocaleString()} entries`} onPress={start} disabled={preview.children.length === 0 || overLimit || allSkipped} />
      {preview.children.length === 0 ? <Text className="text-amber-300 mt-2">No children found on this server.</Text> : null}
    </View>
  );
}

function bbChildInput(bb: BBChild, importRef: string) {
  return {
    name: [bb.first_name, bb.last_name].filter(Boolean).join(' ').trim() || 'Baby',
    birthDate: bb.birth_date,
    birthTime: bb.birth_time ? bb.birth_time.slice(0, 5) : null,
    dueDate: bb.due_date ?? null,
    importRef,
  };
}
