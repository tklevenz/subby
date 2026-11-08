import type { ComponentType } from 'react';
import { Baby, BottleWater, ChildReaching, Flag, Moon, PenToSquare, Pills, PoopDroplet, RulerVertical, Shapes, TemperatureHalf, Toilet, type IconComponent } from './icons';
import { LOG_TYPES, type LogPayload, type LogType } from '@subby/shared';
import type { SheetRequest } from '../store/useSheetStore';
import { colors } from '../theme/colors';

export type LogTypeMeta = {
  label: string;
  Icon: IconComponent;
  color: string;
  /** Tailwind border/background classes for rows and tiles. */
  bg: string;
};

export const TYPE_META: Record<LogType, LogTypeMeta> = {
  feed: { label: 'Feed', Icon: Baby, get color() { return colors.cyanSoft; }, bg: 'border-cyan/40 bg-cyan/10' },
  diaper: { label: 'Diaper', Icon: PoopDroplet, get color() { return colors.amberStrong; }, bg: 'border-amber/40 bg-amber/10' },
  sleep: { label: 'Sleep', Icon: Moon, get color() { return colors.violetStrong; }, bg: 'border-violet/40 bg-violet/10' },
  pumping: { label: 'Pumping', Icon: BottleWater, get color() { return colors.fuchsiaSoft; }, bg: 'border-fuchsia/40 bg-fuchsia/10' },
  growth: { label: 'Growth', Icon: RulerVertical, get color() { return colors.greenSoft; }, bg: 'border-green/40 bg-green/10' },
  temperature: { label: 'Temperature', Icon: TemperatureHalf, get color() { return colors.redSoft; }, bg: 'border-red/40 bg-red/10' },
  medication: { label: 'Medication', Icon: Pills, get color() { return colors.blueSoft; }, bg: 'border-blue/40 bg-blue/10' },
  potty: { label: 'Potty', Icon: Toilet, get color() { return colors.amberPale; }, bg: 'border-yellow/40 bg-yellow/10' },
  activity: { label: 'Activity', Icon: Shapes, get color() { return colors.tealSoft; }, bg: 'border-teal/40 bg-teal/10' },
  milestone: { label: 'Milestone', Icon: Flag, get color() { return colors.orangeSoft; }, bg: 'border-orange/40 bg-orange/10' },
  note: { label: 'Note', Icon: PenToSquare, get color() { return colors.inkSoft; }, bg: 'border-gray/40 bg-gray/10' },
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
    return { key, label: 'Tummy time', Icon: ChildReaching, color, bg, request: { kind: 'log', type: 'activity', payload: { kind: 'tummy_time' } } };
  }
  const meta = TYPE_META[key];
  const request: SheetRequest =
    key === 'feed' ? { kind: 'feed' } : key === 'activity' ? { kind: 'log', type: key, payload: { kind: 'play' } } : { kind: 'log', type: key };
  return { key, label: meta.label, Icon: meta.Icon, get color() { return meta.color; }, bg: meta.bg, request };
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
  return kind === 'tummy_time' ? 'Tummy time' : kind.charAt(0).toUpperCase() + kind.slice(1);
}
