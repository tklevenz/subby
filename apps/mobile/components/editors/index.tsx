import React from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import {
  ACTIVITY_KINDS,
  DIAPER_COLORS,
  MEDICATION_UNITS,
  MILESTONES,
  cToF,
  cmToIn,
  fToC,
  gToLb,
  inToCm,
  lbToG,
  mlToOz,
  ozToMl,
  recentMedications,
  type LogPayload,
  type PayloadOf,
} from '@subby/shared';
import { useLogQuery } from '../../store/queries';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { activityLabel } from '../logTypes';
import { Chip, FieldLabel, Segmented, TextField } from '../ui';
import FoodPicker from './FoodPicker';
import { NumberField, PhotoField, UnitNumberField } from './fields';

export { NumberField } from './fields';

type EditorProps<T extends LogPayload['type']> = {
  payload: PayloadOf<T>;
  onChange: (patch: Partial<PayloadOf<T>>) => void;
};

const id = (n: number) => n;

/** Volume field in ml, shown as oz for imperial users. */
function VolumeField({ value, onChange }: { value?: number; onChange: (ml?: number) => void }) {
  const units = useSettingsStore((s) => s.units);
  return units === 'metric'
    ? <UnitNumberField value={value} onChange={onChange} toDisplay={id} fromDisplay={id} suffix="ml" decimals={0} />
    : <UnitNumberField value={value} onChange={onChange} toDisplay={mlToOz} fromDisplay={ozToMl} suffix="oz" />;
}

function FeedEditor({ payload: p, onChange }: EditorProps<'feed'>) {
  const toMin = (s?: number) => (s === undefined ? undefined : Math.round((s / 60) * 10) / 10);
  const toSec = (m?: number) => (m === undefined ? undefined : Math.round(m * 60));

  return (
    <View>
      <FieldLabel>Method</FieldLabel>
      <Segmented
        options={[{ value: 'breast', label: 'Breast' }, { value: 'bottle', label: 'Bottle' }, { value: 'solids', label: 'Solids' }]}
        value={p.method}
        onChange={(method) =>
          // Drop fields that belong to the other methods.
          onChange({
            method,
            amountMl: undefined, milkType: undefined,
            leftSeconds: undefined, rightSeconds: undefined, lastSide: undefined,
            foods: undefined, allergen: undefined, reaction: undefined, feeder: undefined,
          })
        }
      />
      {p.method === 'bottle' ? (
        <>
          <FieldLabel>Milk</FieldLabel>
          <Segmented
            options={[{ value: 'breast_milk', label: 'Breast milk' }, { value: 'formula', label: 'Formula' }, { value: 'fortified', label: 'Fortified' }]}
            value={p.milkType}
            onChange={(milkType) => onChange({ milkType })}
          />
          <FieldLabel>Amount</FieldLabel>
          <VolumeField value={p.amountMl} onChange={(amountMl) => onChange({ amountMl })} />
        </>
      ) : null}
      {p.method === 'breast' ? (
        <>
          <FieldLabel>Left (minutes)</FieldLabel>
          <NumberField value={toMin(p.leftSeconds)} onChange={(v) => onChange({ leftSeconds: toSec(v) })} suffix="min" />
          <FieldLabel>Right (minutes)</FieldLabel>
          <NumberField value={toMin(p.rightSeconds)} onChange={(v) => onChange({ rightSeconds: toSec(v) })} suffix="min" />
          <FieldLabel>Finished on</FieldLabel>
          <Segmented
            options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
            value={p.lastSide}
            onChange={(lastSide) => onChange({ lastSide })}
          />
        </>
      ) : null}
      {p.method === 'solids' ? (
        <>
          <FoodPicker value={p} onChange={onChange} />
          <FieldLabel>Fed by</FieldLabel>
          <Segmented
            options={[{ value: 'parent', label: 'Parent' }, { value: 'self', label: 'Self-fed' }]}
            value={p.feeder}
            onChange={(feeder) => onChange({ feeder })}
          />
        </>
      ) : null}
    </View>
  );
}

export const COLOR_SWATCH: Record<(typeof DIAPER_COLORS)[number], string> = {
  black: '#0a0a0a', brown: '#7c4a1e', gray: '#9ca3af', green: '#4d7c0f',
  orange: '#f97316', red: '#dc2626', white: '#f8fafc', yellow: '#facc15',
};

function DiaperEditor({ payload: p, onChange }: EditorProps<'diaper'>) {
  return (
    <View>
      <FieldLabel>Condition</FieldLabel>
      <Segmented
        options={[{ value: 'wet', label: 'Wet' }, { value: 'dirty', label: 'Dirty' }, { value: 'both', label: 'Both' }, { value: 'dry', label: 'Dry' }]}
        value={p.condition}
        onChange={(condition) => onChange({ condition })}
      />
      {p.condition === 'dirty' || p.condition === 'both' ? (
        <>
          <FieldLabel>Color</FieldLabel>
          <View className="flex-row flex-wrap gap-3">
            {DIAPER_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => onChange({ color: p.color === c ? undefined : c })}
                className={`items-center rounded-xl p-1.5 border ${p.color === c ? 'border-violet-strong' : 'border-transparent'}`}
              >
                <View style={{ backgroundColor: COLOR_SWATCH[c] }} className="w-8 h-8 rounded-full border border-line-heavy" />
                <Text className="text-ink-muted text-[10px] mt-1">{c}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function SleepEditor({ payload: p, onChange }: EditorProps<'sleep'>) {
  return (
    <View className="flex-row items-center justify-between mt-4">
      <Text className="text-ink-soft text-base">Nap (off = night sleep)</Text>
      <Switch value={p.nap !== false} onValueChange={(nap) => onChange({ nap })} />
    </View>
  );
}

function PumpingEditor({ payload: p, onChange }: EditorProps<'pumping'>) {
  // Total follows L + R when sides are entered; can also be entered alone.
  const setSide = (side: 'leftMl' | 'rightMl', v?: number) => {
    const next = { leftMl: p.leftMl, rightMl: p.rightMl, [side]: v };
    const sum = (next.leftMl ?? 0) + (next.rightMl ?? 0);
    onChange({ ...next, amountMl: next.leftMl !== undefined || next.rightMl !== undefined ? sum : p.amountMl });
  };
  return (
    <View>
      <FieldLabel>Left</FieldLabel>
      <VolumeField value={p.leftMl} onChange={(v) => setSide('leftMl', v)} />
      <FieldLabel>Right</FieldLabel>
      <VolumeField value={p.rightMl} onChange={(v) => setSide('rightMl', v)} />
      <FieldLabel>Total</FieldLabel>
      <VolumeField value={p.amountMl} onChange={(amountMl) => onChange({ amountMl })} />
    </View>
  );
}

function GrowthEditor({ payload: p, onChange }: EditorProps<'growth'>) {
  const metric = useSettingsStore((s) => s.units) === 'metric';
  return (
    <View>
      <FieldLabel>Weight</FieldLabel>
      {metric ? (
        <UnitNumberField value={p.weightG} onChange={(weightG) => onChange({ weightG })} toDisplay={(g) => g / 1000} fromDisplay={(kg) => kg * 1000} suffix="kg" decimals={3} />
      ) : (
        <UnitNumberField value={p.weightG} onChange={(weightG) => onChange({ weightG })} toDisplay={gToLb} fromDisplay={lbToG} suffix="lb" decimals={2} />
      )}
      <FieldLabel>Height / length</FieldLabel>
      {metric ? (
        <UnitNumberField value={p.heightCm} onChange={(heightCm) => onChange({ heightCm })} toDisplay={id} fromDisplay={id} suffix="cm" />
      ) : (
        <UnitNumberField value={p.heightCm} onChange={(heightCm) => onChange({ heightCm })} toDisplay={cmToIn} fromDisplay={inToCm} suffix="in" />
      )}
      <FieldLabel>Head circumference</FieldLabel>
      {metric ? (
        <UnitNumberField value={p.headCm} onChange={(headCm) => onChange({ headCm })} toDisplay={id} fromDisplay={id} suffix="cm" />
      ) : (
        <UnitNumberField value={p.headCm} onChange={(headCm) => onChange({ headCm })} toDisplay={cmToIn} fromDisplay={inToCm} suffix="in" />
      )}
    </View>
  );
}

function TemperatureEditor({ payload: p, onChange }: EditorProps<'temperature'>) {
  const metric = useSettingsStore((s) => s.units) === 'metric';
  const set = (celsius?: number) => celsius !== undefined && onChange({ celsius });
  return (
    <View>
      <FieldLabel>Temperature</FieldLabel>
      {metric ? (
        <UnitNumberField value={p.celsius} onChange={set} toDisplay={id} fromDisplay={id} suffix="°C" />
      ) : (
        <UnitNumberField value={p.celsius} onChange={set} toDisplay={cToF} fromDisplay={fToC} suffix="°F" />
      )}
    </View>
  );
}

const INTERVALS = [
  { value: '0', label: 'None' }, { value: '240', label: '4 h' }, { value: '360', label: '6 h' },
  { value: '480', label: '8 h' }, { value: '720', label: '12 h' }, { value: '1440', label: '24 h' },
] as const;

function MedicationEditor({ payload: p, onChange }: EditorProps<'medication'>) {
  const logs = useLogStore((s) => s.logs);
  const recent = recentMedications(logs);
  return (
    <View>
      {recent.length ? (
        <>
          <FieldLabel>Recent</FieldLabel>
          <View className="flex-row flex-wrap gap-2">
            {recent.map((m) => (
              <Chip
                key={m.name}
                label={m.dose !== undefined ? `${m.name} · ${m.dose} ${m.unit ?? ''}` : m.name}
                selected={p.name.toLowerCase() === m.name.toLowerCase()}
                onPress={() => onChange({ name: m.name, dose: m.dose, unit: m.unit, nextDoseIntervalMin: m.nextDoseIntervalMin })}
              />
            ))}
          </View>
        </>
      ) : null}
      <FieldLabel>Name</FieldLabel>
      <TextField value={p.name} onChangeText={(name) => onChange({ name })} placeholder="e.g. Vitamin D" />
      <FieldLabel>Dose</FieldLabel>
      <NumberField value={p.dose} onChange={(dose) => onChange({ dose })} />
      <View className="mt-2">
        <Segmented options={MEDICATION_UNITS.map((u) => ({ value: u, label: u }))} value={p.unit} onChange={(unit) => onChange({ unit })} />
      </View>
      <FieldLabel>Next dose after</FieldLabel>
      <Segmented
        options={INTERVALS}
        value={String(p.nextDoseIntervalMin ?? 0) as (typeof INTERVALS)[number]['value']}
        onChange={(v) => onChange({ nextDoseIntervalMin: Number(v) || undefined })}
      />
    </View>
  );
}

function PottyEditor({ payload: p, onChange }: EditorProps<'potty'>) {
  return (
    <View>
      <FieldLabel>Result</FieldLabel>
      <Segmented
        options={[{ value: 'pee', label: 'Pee' }, { value: 'poo', label: 'Poo' }, { value: 'both', label: 'Both' }, { value: 'none', label: 'Nothing' }]}
        value={p.result}
        onChange={(result) => onChange({ result })}
      />
      <FieldLabel>Where</FieldLabel>
      <Segmented
        options={[{ value: 'potty', label: 'Potty' }, { value: 'toilet', label: 'Toilet' }, { value: 'other', label: 'Other' }]}
        value={p.location}
        onChange={(location) => onChange({ location })}
      />
      <View className="flex-row items-center justify-between mt-4">
        <Text className="text-ink-soft text-base">Accident</Text>
        <Switch value={p.accident ?? false} onValueChange={(accident) => onChange({ accident: accident || undefined })} />
      </View>
    </View>
  );
}

function ActivityEditor({ payload: p, onChange }: EditorProps<'activity'>) {
  return (
    <View>
      <FieldLabel>Activity</FieldLabel>
      <Segmented options={ACTIVITY_KINDS.map((k) => ({ value: k, label: activityLabel(k) }))} value={p.kind} onChange={(kind) => onChange({ kind })} />
      <FieldLabel>Highlight (optional)</FieldLabel>
      <TextField value={p.milestone ?? ''} onChangeText={(m) => onChange({ milestone: m || undefined })} placeholder="e.g. lifted head for 30 s" />
    </View>
  );
}

const MILESTONE_TYPES = ['milestone'] as const;

function MilestoneEditor({ payload: p, onChange }: EditorProps<'milestone'>) {
  // All-time, so milestones reached long ago still show as done.
  const logs = useLogQuery({ types: MILESTONE_TYPES }) ?? [];
  const achieved = new Set(logs.flatMap((l) => (l.payload.type === 'milestone' && l.payload.key ? [l.payload.key] : [])));
  return (
    <View>
      <FieldLabel>Milestone</FieldLabel>
      <View className="gap-1.5">
        {MILESTONES.map((m) => {
          const selected = p.key === m.key;
          const done = achieved.has(m.key) && !selected;
          return (
            <Pressable
              key={m.key}
              onPress={() => onChange({ key: selected ? undefined : m.key, custom: undefined })}
              className={`flex-row items-center px-3 py-2.5 rounded-xl border ${selected ? 'bg-orange/20 border-orange-strong/60' : 'bg-raised border-line-strong'}`}
            >
              <Text className={`flex-1 ${done ? 'text-ink-faint line-through' : 'text-ink'}`}>{m.label}</Text>
              <Text className="text-ink-faint text-xs">~{m.months} mo</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldLabel>Or something else</FieldLabel>
      <TextField
        value={p.custom ?? ''}
        onChangeText={(custom) => onChange({ custom: custom || undefined, key: custom ? undefined : p.key })}
        placeholder="e.g. First swim"
      />
    </View>
  );
}

function NoteEditor({ payload: p, onChange }: EditorProps<'note'>) {
  return (
    <View>
      <FieldLabel>Note</FieldLabel>
      <TextField
        value={p.text}
        onChangeText={(text) => onChange({ text })}
        placeholder="What happened?"
        multiline
        style={{ minHeight: 96, textAlignVertical: 'top' }}
      />
      <FieldLabel>Photo</FieldLabel>
      <PhotoField value={p.photoUri} onChange={(photoUri) => onChange({ photoUri })} />
    </View>
  );
}

const EDITORS: { [T in LogPayload['type']]: React.ComponentType<EditorProps<T>> } = {
  feed: FeedEditor,
  diaper: DiaperEditor,
  sleep: SleepEditor,
  pumping: PumpingEditor,
  growth: GrowthEditor,
  temperature: TemperatureEditor,
  medication: MedicationEditor,
  potty: PottyEditor,
  activity: ActivityEditor,
  milestone: MilestoneEditor,
  note: NoteEditor,
};

/** Type-specific fields for an entry (used by both the log sheet and the edit screen). */
export function PayloadEditor({
  payload,
  onChange,
}: {
  payload: LogPayload;
  onChange: (patch: Partial<LogPayload>) => void;
}) {
  const Editor = EDITORS[payload.type] as React.ComponentType<EditorProps<typeof payload.type>>;
  return <Editor payload={payload as never} onChange={onChange as never} />;
}
