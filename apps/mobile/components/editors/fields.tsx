import { t } from '@subby/shared/i18n';
import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUpFromBracket, Camera, Download, ImageIcon, ShareNodes, Xmark } from '../icons';
import { canSavePhoto, pickPhoto, savePhoto, sharePhoto } from '../../features/photos';
import { TextField } from '../ui';
import { colors } from '../../theme/colors';

const parse = (text: string) => {
  const n = parseFloat(text.replace(',', '.'));
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
        onChangeText={(text) => {
          setText(text);
          onChange(parse(text));
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
        <Pressable onPress={() => setViewing(true)} accessibilityRole="imagebutton" accessibilityLabel={t('fields.viewPhoto')}>
          <Image source={{ uri: value }} className="w-full rounded-xl" style={{ aspectRatio: Math.max(ratio ?? 4 / 3, 1) }} resizeMode="cover" />
        </Pressable>
        <Pressable
          onPress={() => {
            setRemoved(value);
            onChange(undefined);
          }}
          hitSlop={8}
          accessibilityLabel={t('fields.removePhoto')}
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
          <Text className="text-ink-muted">{t('fields.photoRemoved')}</Text>
          <Pressable
            onPress={() => {
              onChange(removed);
              setRemoved(undefined);
            }}
            hitSlop={8}
          >
            <Text className="text-violet-soft font-semibold">{t('common.undo')}</Text>
          </Pressable>
        </View>
      ) : null}
      <View className="flex-row gap-2">
        <PickButton icon={<ImageIcon color={colors.inkSoft} size={18} />} label={t('fields.library')} onPress={() => pick(false)} />
        <PickButton icon={<Camera color={colors.inkSoft} size={18} />} label={t('fields.camera')} onPress={() => pick(true)} />
      </View>
    </View>
  );
}

function PickButton({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center px-4 py-3 rounded-xl bg-raised border border-line-strong">
      {icon}
      <Text className="text-ink-soft ml-2">{label}</Text>
    </Pressable>
  );
}

/** The whole photo, full screen, with Share (and Save on Android); tap the photo or back to close. */
function PhotoViewer({ uri, onClose }: { uri: string | undefined; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [saved, setSaved] = useState<string>();
  useEffect(() => setSaved(undefined), [uri]);

  const share = () => uri && sharePhoto(uri).catch(() => Alert.alert(t('fields.shareFailed')));
  const save = () =>
    uri &&
    savePhoto(uri)
      .then((name) => setSaved(name))
      .catch(() => Alert.alert(t('fields.saveFailed')));

  // The buttons sit beside the photo's Pressable, not inside it: nested Pressables don't reliably get their own taps on Android.
  return (
    <Modal transparent animationType="fade" visible={!!uri} statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 bg-scrim">
        <Pressable onPress={onClose} accessibilityLabel={t('fields.closePhoto')} className="flex-1">
          {uri ? <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" /> : null}
        </Pressable>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityLabel={t('fields.closePhoto')}
          style={{ top: insets.top + 12 }}
          className="absolute right-4 bg-ground/60 rounded-full p-2"
        >
          <Xmark color={colors.ink} size={18} />
        </Pressable>
        <View style={{ bottom: insets.bottom + 20 }} className="absolute left-0 right-0 items-center">
          {saved ? <Text className="text-ink text-sm mb-3">{t('fields.savedAs', { name: saved })}</Text> : null}
          <View className="flex-row gap-3">
            <Pressable onPress={share} className="flex-row items-center px-5 py-3 rounded-full bg-ground/70 border border-line-strong">
              {Platform.OS === 'ios' ? <ArrowUpFromBracket color={colors.ink} size={16} /> : <ShareNodes color={colors.ink} size={16} />}
              <Text className="text-ink font-medium ml-2">{t('fields.share')}</Text>
            </Pressable>
            {canSavePhoto ? (
              <Pressable onPress={save} className="flex-row items-center px-5 py-3 rounded-full bg-ground/70 border border-line-strong">
                <Download color={colors.ink} size={16} />
                <Text className="text-ink font-medium ml-2">{t('common.save')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
