import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUpFromBracket, Camera, Download, ImageIcon, Plus, ShareNodes, Xmark } from '../icons';
import { recentTags } from '@subby/shared';
import { canSavePhoto, pickPhoto, savePhoto, sharePhoto } from '../../features/photos';
import { useLogStore } from '../../store/useLogStore';
import { Chip, TextField } from '../ui';
import { colors } from '../../theme/colors';

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
      {suffix ? <Text className="text-ink-muted ml-3 w-10">{suffix}</Text> : null}
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
          <Pressable key={t} onPress={() => set(tags.filter((x) => x !== t))} className="flex-row items-center px-3 py-1.5 rounded-full bg-violet/30 border border-violet-strong/60">
            <Text className="text-violet-faint mr-1">{t}</Text>
            <Xmark color={colors.violetPale} size={12} />
          </Pressable>
        ))}
        {suggestions.map((t) => (
          <Chip key={t} label={`+ ${t}`} selected={false} onPress={() => set([...tags, t])} />
        ))}
      </View>
      <View className="flex-row items-center mt-2">
        <TextField className="flex-1" value={draft} onChangeText={setDraft} placeholder="Add tag" onSubmitEditing={add} returnKeyType="done" />
        <Pressable onPress={add} className="ml-2 p-3 rounded-xl bg-raised" hitSlop={6}>
          <Plus color={colors.inkSoft} size={18} />
        </Pressable>
      </View>
    </View>
  );
}

export function PhotoField({ value, onChange }: { value: string | undefined; onChange: (uri: string | undefined) => void }) {
  // The photo just removed, so it can be put back before saving.
  const [removed, setRemoved] = useState<string>();
  const [viewing, setViewing] = useState(false);
  const [ratio, setRatio] = useState<number>();
  useEffect(() => {
    setRatio(undefined);
    if (value) Image.getSize(value, (w, h) => setRatio(w / h), () => {});
  }, [value]);

  const pick = async (camera: boolean) => {
    const uri = await pickPhoto(camera ? 'camera' : 'library');
    if (uri) {
      setRemoved(undefined);
      onChange(uri);
    }
  };

  if (value) {
    return (
      <View>
        {/* Shown at its own shape, up to square for portrait photos; tap for the whole photo. */}
        <Pressable onPress={() => setViewing(true)} accessibilityRole="imagebutton" accessibilityLabel="View photo">
          <Image source={{ uri: value }} className="w-full rounded-xl" style={{ aspectRatio: Math.max(ratio ?? 4 / 3, 1) }} resizeMode="cover" />
        </Pressable>
        <Pressable
          onPress={() => {
            setRemoved(value);
            onChange(undefined);
          }}
          hitSlop={8}
          accessibilityLabel="Remove photo"
          className="absolute top-2 right-2 bg-scrim/60 rounded-full p-1.5"
        >
          <Xmark color={colors.ink} size={16} />
        </Pressable>
        <PhotoViewer uri={viewing ? value : undefined} onClose={() => setViewing(false)} />
      </View>
    );
  }
  return (
    <View>
      {removed ? (
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-ink-muted">Photo removed when you save</Text>
          <Pressable
            onPress={() => {
              onChange(removed);
              setRemoved(undefined);
            }}
            hitSlop={8}
          >
            <Text className="text-violet-soft font-semibold">Undo</Text>
          </Pressable>
        </View>
      ) : null}
      <View className="flex-row gap-2">
        <Pressable onPress={() => pick(false)} className="flex-row items-center px-4 py-3 rounded-xl bg-raised border border-line-strong">
          <ImageIcon color={colors.inkSoft} size={18} />
          <Text className="text-ink-soft ml-2">Library</Text>
        </Pressable>
        <Pressable onPress={() => pick(true)} className="flex-row items-center px-4 py-3 rounded-xl bg-raised border border-line-strong">
          <Camera color={colors.inkSoft} size={18} />
          <Text className="text-ink-soft ml-2">Camera</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The whole photo, full screen, with Share (and Save on Android); tap the photo or back to close. */
function PhotoViewer({ uri, onClose }: { uri: string | undefined; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [saved, setSaved] = useState<string>();
  useEffect(() => setSaved(undefined), [uri]);

  const share = () => uri && sharePhoto(uri).catch(() => Alert.alert("Couldn't share the photo"));
  const save = () =>
    uri &&
    savePhoto(uri)
      .then((name) => setSaved(name))
      .catch(() => Alert.alert("Couldn't save the photo"));

  // The buttons sit beside the photo's Pressable, not inside it: nested Pressables don't reliably get their own taps on Android.
  return (
    <Modal transparent animationType="fade" visible={!!uri} statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 bg-scrim">
        <Pressable onPress={onClose} accessibilityLabel="Close photo" className="flex-1">
          {uri ? <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" /> : null}
        </Pressable>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityLabel="Close photo"
          style={{ top: insets.top + 12 }}
          className="absolute right-4 bg-ground/60 rounded-full p-2"
        >
          <Xmark color={colors.ink} size={18} />
        </Pressable>
        <View style={{ bottom: insets.bottom + 20 }} className="absolute left-0 right-0 items-center">
          {saved ? <Text className="text-ink text-sm mb-3">Saved to Downloads as {saved}</Text> : null}
          <View className="flex-row gap-3">
            <Pressable onPress={share} className="flex-row items-center px-5 py-3 rounded-full bg-ground/70 border border-line-strong">
              {Platform.OS === 'ios' ? <ArrowUpFromBracket color={colors.ink} size={16} /> : <ShareNodes color={colors.ink} size={16} />}
              <Text className="text-ink font-medium ml-2">Share</Text>
            </Pressable>
            {canSavePhoto ? (
              <Pressable onPress={save} className="flex-row items-center px-5 py-3 rounded-full bg-ground/70 border border-line-strong">
                <Download color={colors.ink} size={16} />
                <Text className="text-ink font-medium ml-2">Save</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
