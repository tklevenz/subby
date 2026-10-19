import React from 'react';
import { Switch, Text, View } from 'react-native';
import type { LogPayload, PayloadOf } from '@kindred-log/shared';
import { mlToOz, ozToMl } from '@kindred-log/shared';
import { useSettingsStore } from '../../store/useSettingsStore';
import { FieldLabel, Segmented, TextField } from '../ui';

type EditorProps<T extends LogPayload['type']> = {
  payload: PayloadOf<T>;
  onChange: (patch: Partial<PayloadOf<T>>) => void;
};

/** Numeric input that keeps its own text so partial input ("1.", "") isn't clobbered. */
export function NumberField({
  value,
  onChange,
  placeholder,
  suffix,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  suffix?: string;
}) {
  const [text, setText] = React.useState(value === undefined ? '' : String(value));
  return (
    <View className="flex-row items-center">
      <TextField
        className="flex-1"
        keyboardType="decimal-pad"
        value={text}
        placeholder={placeholder}
        onChangeText={(t) => {
          setText(t);
          const n = parseFloat(t.replace(',', '.'));
          onChange(Number.isFinite(n) ? n : undefined);
        }}
      />
      {suffix ? <Text className="text-slate-400 ml-3 w-10">{suffix}</Text> : null}
    </View>
  );
}

function FeedEditor({ payload: p, onChange }: EditorProps<'feed'>) {
  const units = useSettingsStore((s) => s.units);
  const toMin = (s?: number) => (s === undefined ? undefined : Math.round((s / 60) * 10) / 10);
  const toSec = (m?: number) => (m === undefined ? undefined : Math.round(m * 60));

  return (
    <View>
      <FieldLabel>Method</FieldLabel>
      <Segmented
        options={[{ value: 'breast', label: 'Breast' }, { value: 'bottle', label: 'Bottle' }, { value: 'solids', label: 'Solids' }]}
        value={p.method}
        onChange={(method) => onChange({ method })}
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
          <NumberField
            value={p.amountMl === undefined ? undefined : units === 'metric' ? Math.round(p.amountMl) : Math.round(mlToOz(p.amountMl) * 10) / 10}
            onChange={(v) => onChange({ amountMl: v === undefined ? undefined : units === 'metric' ? v : ozToMl(v) })}
            suffix={units === 'metric' ? 'ml' : 'oz'}
          />
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
          <FieldLabel>Foods (comma separated)</FieldLabel>
          <TextField
            defaultValue={p.foods?.join(', ')}
            onChangeText={(t) => onChange({ foods: t.split(',').map((f) => f.trim()).filter(Boolean) })}
            placeholder="e.g. carrot, banana"
          />
        </>
      ) : null}
    </View>
  );
}

function DiaperEditor({ payload: p, onChange }: EditorProps<'diaper'>) {
  return (
    <View>
      <FieldLabel>Condition</FieldLabel>
      <Segmented
        options={[{ value: 'wet', label: 'Wet' }, { value: 'dirty', label: 'Dirty' }, { value: 'both', label: 'Both' }, { value: 'dry', label: 'Dry' }]}
        value={p.condition}
        onChange={(condition) => onChange({ condition })}
      />
    </View>
  );
}

function SleepEditor({ payload: p, onChange }: EditorProps<'sleep'>) {
  return (
    <View className="flex-row items-center justify-between mt-4">
      <Text className="text-slate-300 text-base">Nap</Text>
      <Switch value={p.nap !== false} onValueChange={(nap) => onChange({ nap })} />
    </View>
  );
}

const EDITORS: { [T in LogPayload['type']]?: React.ComponentType<EditorProps<T>> } = {
  feed: FeedEditor,
  diaper: DiaperEditor,
  sleep: SleepEditor,
};

/** Type-specific fields for an entry; types without an editor show only the common fields. */
export function PayloadEditor({
  payload,
  onChange,
}: {
  payload: LogPayload;
  onChange: (patch: Partial<LogPayload>) => void;
}) {
  const Editor = EDITORS[payload.type] as React.ComponentType<EditorProps<typeof payload.type>> | undefined;
  return Editor ? <Editor payload={payload as never} onChange={onChange as never} /> : null;
}
