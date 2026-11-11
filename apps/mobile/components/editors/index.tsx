import { t } from '@subby/shared/i18n';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  ACTIVITY_KINDS,
  DIAPER_COLORS,
  MEDICATION_UNITS,
  medicationUnit,
  MILESTONES,
  MEASURES,
  type Measure,
  recentMedications,
  type LogPayload,
  type PayloadOf,
  formatDose,
} from '@subby/shared';
import { useLogQuery } from '../../store/queries';
import { useLogStore } from '../../store/useLogStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { activityLabel, feedMethods, milkTypes } from '../logTypes';
import { Chip, FieldLabel, Segmented, TextField, Toggle } from '../ui';
import FoodPicker from './FoodPicker';
import { NumberField, PhotoField, UnitNumberField } from './fields';

export { NumberField } from './fields';

type EditorProps<T extends LogPayload['type']> = {
  payload: PayloadOf<T>;
  onChange: (patch: Partial<PayloadOf<T>>) => void;
};

/** A quantity entered in the phone's unit system (ml or oz, kg or lb, cm or in, °C or °F); the value is canonical. */
function MeasureField({ measure, value, onChange }: { measure: Measure; value?: number; onChange: (canonical?: number) => void }) {
  const units = useSettingsStore((s) => s.units);
  const m = MEASURES[measure][units];
  return <UnitNumberField value={value} onChange={onChange} toDisplay={m.to} fromDisplay={m.from} suffix={m.suffix} decimals={m.decimals} />;
}

function FeedEditor({ payload: p, onChange }: EditorProps<'feed'>) {
  const toMin = (s?: number) => (s === undefined ? undefined : Math.round((s / 60) * 10) / 10);
  const toSec = (m?: number) => (m === undefined ? undefined : Math.round(m * 60));

  return (
    <View>
      <FieldLabel>{t('editor.method')}</FieldLabel>
      <Segmented
        options={feedMethods()}
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
          <FieldLabel>{t('feedSheet.milk')}</FieldLabel>
          <Segmented
            options={milkTypes()}
            value={p.milkType}
            onChange={(milkType) => onChange({ milkType })}
          />
          <FieldLabel>{t('feedSheet.amount')}</FieldLabel>
          <MeasureField measure="volume" value={p.amountMl} onChange={(amountMl) => onChange({ amountMl })} />
        </>
      ) : null}
      {p.method === 'breast' ? (
        <>
          <FieldLabel>{t('editor.leftMinutes')}</FieldLabel>
          <NumberField value={toMin(p.leftSeconds)} onChange={(v) => onChange({ leftSeconds: toSec(v) })} suffix={t('editor.min')} />
          <FieldLabel>{t('editor.rightMinutes')}</FieldLabel>
          <NumberField value={toMin(p.rightSeconds)} onChange={(v) => onChange({ rightSeconds: toSec(v) })} suffix={t('editor.min')} />
          <FieldLabel>{t('editor.finishedOn')}</FieldLabel>
          <Segmented
            options={[{ value: 'left', label: t('editor.left') }, { value: 'right', label: t('editor.right') }]}
            value={p.lastSide}
            onChange={(lastSide) => onChange({ lastSide })}
          />
        </>
      ) : null}
      {p.method === 'solids' ? (
        <>
          <FoodPicker value={p} onChange={onChange} />
          <FieldLabel>{t('editor.fedBy')}</FieldLabel>
          <Segmented
            options={[{ value: 'parent', label: t('editor.parent') }, { value: 'self', label: t('editor.selfFed') }]}
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
      <FieldLabel>{t('editor.condition')}</FieldLabel>
      <Segmented
        options={[
          { value: 'wet', label: t('diaper.wet') },
          { value: 'dirty', label: t('diaper.dirty') },
          { value: 'both', label: t('diaper.both') },
          { value: 'dry', label: t('diaper.dry') },
        ]}
        value={p.condition}
        onChange={(condition) => onChange({ condition })}
      />
      {p.condition === 'dirty' || p.condition === 'both' ? (
        <>
          <FieldLabel>{t('editor.color')}</FieldLabel>
          <View className="flex-row flex-wrap gap-3">
            {DIAPER_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => onChange({ color: p.color === c ? undefined : c })}
                className={`items-center rounded-xl p-1.5 border ${p.color === c ? 'border-violet-strong' : 'border-transparent'}`}
              >
                <View style={{ backgroundColor: COLOR_SWATCH[c] }} className="w-8 h-8 rounded-full border border-line-heavy" />
                <Text className="text-ink-muted text-[10px] mt-1">{t(`diaperColor.${c}`)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const sleepKinds = () =>
  [
    { value: 'nap', label: t('row.nap') },
    { value: 'night', label: t('row.nightSleep') },
  ] as const;

function SleepEditor({ payload: p, onChange }: EditorProps<'sleep'>) {
  return (
    <View>
      <FieldLabel>{t('editor.kind')}</FieldLabel>
      <Segmented options={sleepKinds()} value={p.nap !== false ? 'nap' : 'night'} onChange={(kind) => onChange({ nap: kind === 'nap' })} />
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
      <FieldLabel>{t('editor.left')}</FieldLabel>
      <MeasureField measure="volume" value={p.leftMl} onChange={(v) => setSide('leftMl', v)} />
      <FieldLabel>{t('editor.right')}</FieldLabel>
      <MeasureField measure="volume" value={p.rightMl} onChange={(v) => setSide('rightMl', v)} />
      <FieldLabel>{t('editor.total')}</FieldLabel>
      <MeasureField measure="volume" value={p.amountMl} onChange={(amountMl) => onChange({ amountMl })} />
    </View>
  );
}

function GrowthEditor({ payload: p, onChange }: EditorProps<'growth'>) {
  return (
    <View>
      <FieldLabel>{t('editor.weight')}</FieldLabel>
      <MeasureField measure="weight" value={p.weightG} onChange={(weightG) => onChange({ weightG })} />
      <FieldLabel>{t('editor.height')}</FieldLabel>
      <MeasureField measure="length" value={p.heightCm} onChange={(heightCm) => onChange({ heightCm })} />
      <FieldLabel>{t('editor.head')}</FieldLabel>
      <MeasureField measure="length" value={p.headCm} onChange={(headCm) => onChange({ headCm })} />
    </View>
  );
}

function TemperatureEditor({ payload: p, onChange }: EditorProps<'temperature'>) {
  const set = (celsius?: number) => celsius !== undefined && onChange({ celsius });
  return (
    <View>
      <FieldLabel>{t('editor.temperature')}</FieldLabel>
      <MeasureField measure="temperature" value={p.celsius} onChange={set} />
    </View>
  );
}

const INTERVAL_VALUES = ['0', '240', '360', '480', '720', '1440'] as const;
const intervals = () =>
  INTERVAL_VALUES.map((value) => ({ value, label: value === '0' ? t('editor.none') : t('editor.hours', { count: Number(value) / 60 }) }));

function MedicationEditor({ payload: p, onChange }: EditorProps<'medication'>) {
  const logs = useLogStore((s) => s.logs);
  const recent = recentMedications(logs);
  return (
    <View>
      {recent.length ? (
        <>
          <FieldLabel>{t('editor.recent')}</FieldLabel>
          <View className="flex-row flex-wrap gap-2">
            {recent.map((m) => (
              <Chip
                key={m.name}
                label={m.dose !== undefined ? t('summary.pair', { a: m.name, b: formatDose(m.dose, m.unit) }) : m.name}
                selected={p.name.toLowerCase() === m.name.toLowerCase()}
                onPress={() => onChange({ name: m.name, dose: m.dose, unit: m.unit, nextDoseIntervalMin: m.nextDoseIntervalMin })}
              />
            ))}
          </View>
        </>
      ) : null}
      <FieldLabel>{t('editor.name')}</FieldLabel>
      <TextField value={p.name} onChangeText={(name) => onChange({ name })} placeholder={t('editor.medicationPlaceholder')} />
      <FieldLabel>{t('editor.dose')}</FieldLabel>
      <NumberField value={p.dose} onChange={(dose) => onChange({ dose })} />
      <View className="mt-2">
        <Segmented options={MEDICATION_UNITS.map((u) => ({ value: u, label: medicationUnit(u, p.dose ?? 2) }))} value={p.unit} onChange={(unit) => onChange({ unit })} />
      </View>
      <FieldLabel>{t('editor.nextDose')}</FieldLabel>
      <Segmented
        options={intervals()}
        value={String(p.nextDoseIntervalMin ?? 0) as (typeof INTERVAL_VALUES)[number]}
        onChange={(v) => onChange({ nextDoseIntervalMin: Number(v) || undefined })}
      />
    </View>
  );
}

function PottyEditor({ payload: p, onChange }: EditorProps<'potty'>) {
  return (
    <View>
      <FieldLabel>{t('editor.result')}</FieldLabel>
      <Segmented
        options={[
          { value: 'pee', label: t('editor.pee') },
          { value: 'poo', label: t('editor.poo') },
          { value: 'both', label: t('editor.both') },
          { value: 'none', label: t('editor.nothing') },
        ]}
        value={p.result}
        onChange={(result) => onChange({ result })}
      />
      <FieldLabel>{t('editor.where')}</FieldLabel>
      <Segmented
        options={[
          { value: 'potty', label: t('editor.potty') },
          { value: 'toilet', label: t('editor.toilet') },
          { value: 'other', label: t('editor.other') },
        ]}
        value={p.location}
        onChange={(location) => onChange({ location })}
      />
      <View className="flex-row items-center justify-between mt-4">
        <Text className="text-ink-soft text-base">{t('editor.accident')}</Text>
        <Toggle value={p.accident ?? false} onValueChange={(accident) => onChange({ accident: accident || undefined })} />
      </View>
    </View>
  );
}

function ActivityEditor({ payload: p, onChange }: EditorProps<'activity'>) {
  return (
    <View>
      <FieldLabel>{t('editor.activity')}</FieldLabel>
      <Segmented options={ACTIVITY_KINDS.map((k) => ({ value: k, label: activityLabel(k) }))} value={p.kind} onChange={(kind) => onChange({ kind })} />
      <FieldLabel>{t('editor.highlight')}</FieldLabel>
      <TextField value={p.milestone ?? ''} onChangeText={(m) => onChange({ milestone: m || undefined })} placeholder={t('editor.highlightPlaceholder')} />
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
      <FieldLabel>{t('editor.milestone')}</FieldLabel>
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
              <Text className="text-ink-faint text-xs">{t('editor.milestoneAge', { count: m.months })}</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldLabel>{t('editor.somethingElse')}</FieldLabel>
      <TextField
        value={p.custom ?? ''}
        onChangeText={(custom) => onChange({ custom: custom || undefined, key: custom ? undefined : p.key })}
        placeholder={t('editor.somethingElsePlaceholder')}
      />
    </View>
  );
}

function NoteEditor({ payload: p, onChange }: EditorProps<'note'>) {
  return (
    <View>
      <FieldLabel>{t('editor.note')}</FieldLabel>
      <TextField
        value={p.text}
        onChangeText={(text) => onChange({ text })}
        placeholder={t('editor.notePlaceholder')}
        multiline
        style={{ minHeight: 96, textAlignVertical: 'top' }}
      />
      <FieldLabel>{t('editor.photo')}</FieldLabel>
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
