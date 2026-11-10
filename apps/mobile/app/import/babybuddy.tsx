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
    <ScreenScroll className="flex-1 bg-ground" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Import from Baby Buddy', headerShown: true, gestureEnabled: step.kind !== 'running' }} />

      {step.kind === 'connect' ? (
        <View>
          <Lead>
            Copies your history from a Baby Buddy server onto this device. It only reads from Baby Buddy, and you can run
            it again later to pick up new entries without creating duplicates.
          </Lead>
          <FieldLabel>Server address</FieldLabel>
          <TextField value={url} onChangeText={setUrl} placeholder="https://babybuddy.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <FieldLabel>API key (Baby Buddy → User Settings)</FieldLabel>
          <TextField value={token} onChangeText={setToken} placeholder="API key" autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Text className="text-ink-faint text-xs mt-2">The key is used for this import only and is not saved.</Text>
          {url.trim().toLowerCase().startsWith('http://') ? (
            <Text className="text-amber-soft text-xs mt-2">This address isn't encrypted (http). Your key and data travel in plain text.</Text>
          ) : null}
          {error ? <ErrorText className="mt-3">{error}</ErrorText> : null}
          {busy ? <View className="items-center mt-4"><SubSpinner size={36} /></View> : (
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
          {step.progress ? (
            <>
              <Text className="text-ink text-base mt-4">{LABELS[step.progress.endpoint]}</Text>
              <Text className="text-ink-muted mt-1">{step.progress.done} / {step.progress.total}</Text>
              <View className="w-full mt-3">
                <SubProgress progress={step.progress.done / Math.max(1, step.progress.total)} />
              </View>
              <Text className="text-ink-faint text-xs mt-2">
                Step {BB_ENDPOINTS.indexOf(step.progress.endpoint) + 1} of {BB_ENDPOINTS.length}
              </Text>
            </>
          ) : (
            <>
              <SubLoader />
              <Text className="text-ink-muted mt-4">Starting…</Text>
            </>
          )}
          <View className="w-full">
            <Button label="Cancel" variant="ghost" onPress={() => (cancelled.current = true)} />
          </View>
          <Text className="text-ink-faint text-xs mt-2 text-center">Already imported entries stay; run the import again to continue.</Text>
        </View>
      ) : null}

      {step.kind === 'done' ? (
        <View>
          <Text className="text-xl font-bold text-ink">{step.result.cancelled ? 'Import cancelled' : 'Import finished'}</Text>
          <Card>
            <Row label="Imported" value={String(step.result.imported)} />
            <Row label="Already imported (skipped)" value={String(step.result.skipped)} />
            {step.result.excluded ? <Row label="Left out (children not imported)" value={String(step.result.excluded)} /> : null}
            <Row label="Couldn't import" value={String(step.result.failed.length)} />
          </Card>
          {step.result.failed.slice(0, 5).map((f) => (
            <Text key={f.ref} className="text-red-soft text-xs mt-2">{f.ref}: {f.reason}</Text>
          ))}
          <Text className="text-ink-muted mt-4 leading-5">
            Done with Baby Buddy? Regenerate your API key there (User Settings) so the copied key stops working.
          </Text>
          <Button label="Done" onPress={() => router.replace('/')} />
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
      { value: NEW, label: 'New child' },
      ...localChildren.map((k) => ({ value: k.id, label: k.name })),
      { value: SKIP, label: "Don't import" },
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
      <Text className="text-ink text-lg font-semibold">Found {total.toLocaleString()} entries</Text>
      <Card>
        {BB_ENDPOINTS.filter((e) => preview.counts[e] > 0).map((e) => (
          <Row key={e} label={LABELS[e]} value={preview.counts[e].toLocaleString()} />
        ))}
      </Card>

      <FieldLabel>Children</FieldLabel>
      {preview.children.map((bb) => (
        <View key={bb.id} className="mb-3">
          <Text className="text-ink-light mb-2">{bb.first_name} {bb.last_name} · born {bb.birth_date} → import into</Text>
          <Segmented options={childOptions} value={mapping[bb.id]} onChange={(v) => setMapping((m) => ({ ...m, [bb.id]: v }))} />
        </View>
      ))}

      <FieldLabel>Units in Baby Buddy (detected — check the examples)</FieldLabel>
      {(Object.keys(UNIT_OPTIONS) as (keyof ImportUnits)[]).map((measure) => (
        <View key={measure} className="mb-3">
          <Text className="text-ink-soft mb-1.5 capitalize">
            {measure} <Text className="text-ink-faint">· {unitExample(measure, preview.examples[measure], units, settings.units)}</Text>
          </Text>
          <Segmented
            options={UNIT_OPTIONS[measure] as { value: string; label: string }[]}
            value={units[measure]}
            onChange={(v) => setUnits((u) => ({ ...u, [measure]: v }))}
          />
        </View>
      ))}

      <Button label={`Import ${total.toLocaleString()} entries`} onPress={start} disabled={preview.children.length === 0 || allSkipped} />
      {preview.children.length === 0 ? <WarningText className="mt-2">No children found on this server.</WarningText> : null}
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
