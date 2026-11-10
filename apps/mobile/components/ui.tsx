import React from 'react';
import { View, Text, Pressable, TextInput, Platform, Switch, type SwitchProps, type TextInputProps, type TextProps } from 'react-native';
import { AngleRight } from './icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  /** Shown before the label. */
  icon?: React.ReactNode;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      className={`flex-row items-center gap-1.5 px-4 py-2 rounded-full border ${
        selected ? 'bg-violet/30 border-violet-strong/60' : 'bg-raised border-line-strong'
      }`}
    >
      {icon}
      <Text className={selected ? 'text-violet-faint font-medium' : 'text-ink-muted'}>{label}</Text>
    </Pressable>
  );
}

/** Single-choice chip row. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => (
        <Chip key={o.value} label={o.label} selected={value === o.value} onPress={() => onChange(o.value)} />
      ))}
    </View>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text className="text-xs text-ink-muted font-medium mb-2 mt-4">{children}</Text>;
}

/**
 * For secrets typed in the clear (recovery words): no suggestions, corrections or autofill, and the keyboard
 * doesn't learn them. On Android only a password type stops Gboard's learning; `visible-password` keeps the text readable.
 */
export const SECRET_INPUT: TextInputProps = {
  autoCapitalize: 'none',
  autoCorrect: false,
  spellCheck: false,
  autoComplete: 'off',
  importantForAutofill: 'no',
  keyboardType: Platform.OS === 'android' ? 'visible-password' : 'default',
};

export function TextField(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.inkFaint}
      cursorColor={colors.violetSoft}
      selectionColor={colors.violetStrong}
      {...props}
      className={`bg-raised border border-line-strong rounded-xl px-4 py-3 text-ink text-base ${props.className ?? ''}`}
    />
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  /** `dangerQuiet` for a destructive action that still asks first: it shouldn't shout next to Save. */
  variant?: 'primary' | 'danger' | 'dangerQuiet' | 'ghost';
  disabled?: boolean;
}) {
  const bg = {
    primary: 'bg-violet-deep',
    danger: 'bg-red-deep/80',
    dangerQuiet: 'bg-red/10 border border-red/30',
    ghost: 'bg-raised',
  }[variant];
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      className={`${bg} rounded-xl py-3.5 px-5 items-center mt-4 ${disabled ? 'opacity-40' : ''}`}
    >
      <Text className={`${variant === 'dangerQuiet' ? 'text-red-soft' : 'text-ink'} font-semibold text-base`}>{label}</Text>
    </Pressable>
  );
}

/** The switch in the accent color, instead of each platform's default. */
export function Toggle(props: SwitchProps) {
  return (
    <Switch
      trackColor={{ false: colors.lineStrong, true: colors.violetDeep }}
      thumbColor={props.value ? colors.violetPale : colors.inkMuted}
      ios_backgroundColor={colors.lineStrong}
      {...props}
    />
  );
}

/** The uppercase label above a group of cards. */
export function SectionLabel({ children, className = 'mt-6 mb-2' }: { children: React.ReactNode; className?: string }) {
  return <Text className={`text-xs font-semibold text-ink-muted uppercase ml-1 ${className}`}>{children}</Text>;
}

/** A screen's opening paragraph. */
export function Lead({ className = '', ...props }: TextProps & { className?: string }) {
  return <Text {...props} className={`text-ink-soft text-[15px] leading-[22px] ${className}`} />;
}

/** Something went wrong. */
export function ErrorText({ className = 'mt-3', ...props }: TextProps & { className?: string }) {
  return <Text {...props} className={`text-red-soft text-sm leading-5 ${className}`} />;
}

/** Worth knowing before going on. */
export function WarningText({ className = 'mt-3', ...props }: TextProps & { className?: string }) {
  return <Text {...props} className={`text-amber-soft text-sm leading-5 ${className}`} />;
}

/** The arrow on a row that opens something. */
export function Chevron() {
  return <AngleRight color={colors.inkGhost} size={16} />;
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View className="bg-surface rounded-2xl border border-line overflow-hidden">{children}</View>;
}

export function Row({
  label,
  value,
  onPress,
  right,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} className="flex-row items-center px-4 py-3.5 border-b border-line">
      <Text className="flex-1 text-ink text-base">{label}</Text>
      {value ? <Text className="text-ink-muted text-base">{value}</Text> : null}
      {right}
    </Pressable>
  );
}
