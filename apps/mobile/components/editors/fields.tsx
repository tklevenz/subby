import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Camera, ImagePlus, Plus, X } from 'lucide-react-native';
import { recentTags } from '@kindred-log/shared';
import { useLogStore } from '../../store/useLogStore';
import { Chip, TextField } from '../ui';

const parse = (t: string) => {
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
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
  const [text, setText] = useState(value === undefined ? '' : String(value));

  // Follow external changes (e.g. a preset chip), but not our own keystrokes.
  useEffect(() => {
    if (parse(text) !== value) setText(value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <View className="flex-row items-center">
      <TextField
        className="flex-1"
        keyboardType="decimal-pad"
        value={text}
        placeholder={placeholder}
        onChangeText={(t) => {
          setText(t);
          onChange(parse(t));
        }}
      />
      {suffix ? <Text className="text-slate-400 ml-3 w-10">{suffix}</Text> : null}
    </View>
  );
}

/** NumberField over a canonical value shown in a display unit (e.g. ml shown as oz). */
export function UnitNumberField({
  value,
  onChange,
  toDisplay,
  fromDisplay,
  suffix,
  decimals = 1,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  toDisplay: (canonical: number) => number;
  fromDisplay: (display: number) => number;
  suffix: string;
  decimals?: number;
}) {
  const f = 10 ** decimals;
  return (
    <NumberField
      value={value === undefined ? undefined : Math.round(toDisplay(value) * f) / f}
      onChange={(v) => onChange(v === undefined ? undefined : fromDisplay(v))}
      suffix={suffix}
    />
  );
}

/** Free-form tags with recent tags as quick chips. */
export function TagsField({ value, onChange }: { value: string[] | undefined; onChange: (tags: string[] | undefined) => void }) {
  const logs = useLogStore((s) => s.logs);
  const [draft, setDraft] = useState('');
  const tags = value ?? [];
  const suggestions = recentTags(logs).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));

  const set = (next: string[]) => onChange(next.length ? next : undefined);
  const add = () => {
    const t = draft.trim();
    if (t && !tags.includes(t)) set([...tags, t]);
    setDraft('');
  };

  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        {tags.map((t) => (
          <Pressable key={t} onPress={() => set(tags.filter((x) => x !== t))} className="flex-row items-center px-3 py-1.5 rounded-full bg-violet-500/30 border border-violet-400/60">
            <Text className="text-violet-100 mr-1">{t}</Text>
            <X color="#ddd6fe" size={12} />
          </Pressable>
        ))}
        {suggestions.map((t) => (
          <Chip key={t} label={`+ ${t}`} selected={false} onPress={() => set([...tags, t])} />
        ))}
      </View>
      <View className="flex-row items-center mt-2">
        <TextField className="flex-1" value={draft} onChangeText={setDraft} placeholder="Add tag" onSubmitEditing={add} returnKeyType="done" />
        <Pressable onPress={add} className="ml-2 p-3 rounded-xl bg-slate-800" hitSlop={6}>
          <Plus color="#cbd5e1" size={18} />
        </Pressable>
      </View>
    </View>
  );
}

/** Copy a picked image into the app's document dir so it outlives the picker cache. */
async function persistPhoto(uri: string): Promise<string> {
  const dir = new Directory(Paths.document, 'photos');
  dir.create({ idempotent: true, intermediates: true });
  const ext = uri.split('.').pop()?.split('?')[0] || 'jpg';
  const dest = new File(dir, `${Date.now()}.${ext}`);
  await new File(uri).copy(dest);
  return dest.uri;
}

export function PhotoField({ value, onChange }: { value: string | undefined; onChange: (uri: string | undefined) => void }) {
  const pick = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
    }
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!res.canceled && res.assets[0]) onChange(await persistPhoto(res.assets[0].uri));
  };

  if (value) {
    return (
      <View>
        <Image source={{ uri: value }} className="w-full h-48 rounded-xl" resizeMode="cover" />
        <Pressable onPress={() => onChange(undefined)} className="absolute top-2 right-2 bg-black/60 rounded-full p-1.5">
          <X color="#fff" size={16} />
        </Pressable>
      </View>
    );
  }
  return (
    <View className="flex-row gap-2">
      <Pressable onPress={() => pick(false)} className="flex-row items-center px-4 py-3 rounded-xl bg-slate-800 border border-slate-700">
        <ImagePlus color="#cbd5e1" size={18} />
        <Text className="text-slate-300 ml-2">Library</Text>
      </Pressable>
      <Pressable onPress={() => pick(true)} className="flex-row items-center px-4 py-3 rounded-xl bg-slate-800 border border-slate-700">
        <Camera color="#cbd5e1" size={18} />
        <Text className="text-slate-300 ml-2">Camera</Text>
      </Pressable>
    </View>
  );
}
