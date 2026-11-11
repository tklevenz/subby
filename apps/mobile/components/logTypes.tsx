import React, { type ComponentType } from 'react';
import { Baby, BottleWater, ChildReaching, Droplet, Flag, Moon, PenToSquare, Pills, Poop, PoopDroplet, RulerVertical, Shapes, TemperatureHalf, Toilet, type IconComponent, type IconProps } from './icons';
import { ACTIVITY_KINDS, LOG_TYPES, type DiaperColor, type LogPayload, type LogType } from '@subby/shared';
import { t } from '@subby/shared/i18n';
import type { SheetRequest } from '../store/useSheetStore';
import { colors } from '../theme/colors';

export type LogTypeMeta = {
  /** In the app's language (a getter: read when shown). */
  readonly label: string;
  Icon: IconComponent;
  color: string;
  /** Tailwind border/background classes for rows and tiles. */
  bg: string;
};

export const TYPE_META: Record<LogType, LogTypeMeta> = {
  feed: { get label() { return t('type.feed'); }, Icon: Baby, get color() { return colors.cyanSoft; }, bg: 'border-cyan/40 bg-cyan/10' },
  diaper: { get label() { return t('type.diaper'); }, Icon: PoopDroplet, get color() { return colors.amberStrong; }, bg: 'border-amber/40 bg-amber/10' },
  sleep: { get label() { return t('type.sleep'); }, Icon: Moon, get color() { return colors.violetStrong; }, bg: 'border-violet/40 bg-violet/10' },
  pumping: { get label() { return t('type.pumping'); }, Icon: BottleWater, get color() { return colors.fuchsiaSoft; }, bg: 'border-fuchsia/40 bg-fuchsia/10' },
  growth: { get label() { return t('type.growth'); }, Icon: RulerVertical, get color() { return colors.greenSoft; }, bg: 'border-green/40 bg-green/10' },
  temperature: { get label() { return t('type.temperature'); }, Icon: TemperatureHalf, get color() { return colors.redSoft; }, bg: 'border-red/40 bg-red/10' },
  medication: { get label() { return t('type.medication'); }, Icon: Pills, get color() { return colors.blueSoft; }, bg: 'border-blue/40 bg-blue/10' },
  potty: { get label() { return t('type.potty'); }, Icon: Toilet, get color() { return colors.amberPale; }, bg: 'border-yellow/40 bg-yellow/10' },
  activity: { get label() { return t('type.activity'); }, Icon: Shapes, get color() { return colors.tealSoft; }, bg: 'border-teal/40 bg-teal/10' },
  milestone: { get label() { return t('type.milestone'); }, Icon: Flag, get color() { return colors.orangeSoft; }, bg: 'border-orange/40 bg-orange/10' },
  note: { get label() { return t('type.note'); }, Icon: PenToSquare, get color() { return colors.inkSoft; }, bg: 'border-gray/40 bg-gray/10' },
};

/**
 * The things you can log, as tiles (the "log something" grid): every log type, with tummy time, the activity
 * logged most, as its own tile. "Activity" opens with Play, for the rest.
 */
export type LogTileKey = LogType | 'tummy';
export type LogTile = LogTypeMeta & { key: LogTileKey; request: SheetRequest };

export const LOG_TILE_KEYS: readonly LogTileKey[] = LOG_TYPES.flatMap((t): LogTileKey[] => (t === 'activity' ? ['tummy', t] : [t]));

export function logTile(key: LogTileKey): LogTile {
  if (key === 'tummy') {
    const { color, bg } = TYPE_META.activity;
    return { key, get label() { return t('activity.tummy_time'); }, Icon: ChildReaching, color, bg, request: { kind: 'log', type: 'activity', payload: { kind: 'tummy_time' } } };
  }
  const meta = TYPE_META[key];
  const request: SheetRequest =
    key === 'feed' ? { kind: 'feed' } : key === 'activity' ? { kind: 'log', type: key, payload: { kind: 'play' } } : { kind: 'log', type: key };
  return { key, get label() { return meta.label; }, Icon: meta.Icon, get color() { return meta.color; }, bg: meta.bg, request };
}

/** Starting payload for a new entry of each type. */
export function defaultPayload(type: LogType): LogPayload {
  switch (type) {
    case 'feed': return { type, method: 'bottle' };
    case 'diaper': return { type, condition: 'wet' };
    case 'sleep': return { type, nap: true };
    case 'pumping': return { type };
    case 'growth': return { type };
    case 'temperature': return { type, celsius: 37 };
    case 'medication': return { type, name: '' };
    case 'potty': return { type, result: 'pee' };
    case 'activity': return { type, kind: 'tummy_time' };
    case 'milestone': return { type };
    case 'note': return { type, text: '' };
  }
}

export function activityLabel(kind: string): string {
  return (ACTIVITY_KINDS as readonly string[]).includes(kind) ? t(`activity.${kind as (typeof ACTIVITY_KINDS)[number]}`) : kind;
}

/**
 * A diaper's own icon and color, as on the diaper sheet: wet is a blue drop, dirty a brown poop, both the two
 * together. Anything else (dry) keeps the generic diaper icon.
 */
export function diaperLook(condition: Extract<LogPayload, { type: 'diaper' }>['condition']): { Icon: (p: IconProps) => React.ReactNode; color: string } {
  switch (condition) {
    case 'wet':
      return { Icon: (p) => <Droplet {...p} color={colors.blueSoft} />, color: colors.blueSoft };
    case 'dirty':
      return { Icon: (p) => <Poop {...p} color={colors.brownStrong} />, color: colors.brownStrong };
    case 'both':
      return { Icon: (p) => <PoopDroplet {...p} color={colors.brownStrong} dropColor={colors.blueSoft} />, color: colors.amberStrong };
    default:
      return { Icon: (p) => <PoopDroplet {...p} color={colors.amberStrong} />, color: colors.amberStrong };
  }
}

/** What each diaper color looks like: data colors, not theme ones. */
export const COLOR_SWATCH: Record<DiaperColor, string> = {
  black: '#0a0a0a', brown: '#7c4a1e', gray: '#9ca3af', green: '#4d7c0f',
  orange: '#f97316', red: '#dc2626', white: '#f8fafc', yellow: '#facc15',
};

/** The ways to feed, labelled in the current language (the feed sheet's tabs and the editor's choice). */
export const feedMethods = () =>
  [
    { value: 'breast', label: t('feed.breast') },
    { value: 'bottle', label: t('feed.bottle') },
    { value: 'solids', label: t('feed.solids') },
  ] as const;

/** What a bottle holds. */
export const milkTypes = () =>
  [
    { value: 'breast_milk', label: t('feed.breastMilk') },
    { value: 'formula', label: t('feed.formula') },
    { value: 'fortified', label: t('feedSheet.fortified') },
  ] as const;
