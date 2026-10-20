import type { ComponentType } from 'react';
import {
  Activity,
  Baby,
  Droplets,
  Flag,
  Milk,
  Moon,
  NotebookPen,
  Pill,
  Ruler,
  Thermometer,
  Toilet,
  type LucideProps,
} from 'lucide-react-native';
import type { LogPayload, LogType } from '@kindred-log/shared';
import { colors } from '../theme/colors';

export type LogTypeMeta = {
  label: string;
  Icon: ComponentType<LucideProps>;
  color: string;
  /** Tailwind border/background classes for rows and tiles. */
  bg: string;
};

export const TYPE_META: Record<LogType, LogTypeMeta> = {
  feed: { label: 'Feed', Icon: Baby, get color() { return colors.cyanSoft; }, bg: 'border-cyan/40 bg-cyan/10' },
  diaper: { label: 'Diaper', Icon: Droplets, get color() { return colors.amberStrong; }, bg: 'border-amber/40 bg-amber/10' },
  sleep: { label: 'Sleep', Icon: Moon, get color() { return colors.violetStrong; }, bg: 'border-violet/40 bg-violet/10' },
  pumping: { label: 'Pumping', Icon: Milk, get color() { return colors.fuchsiaSoft; }, bg: 'border-fuchsia/40 bg-fuchsia/10' },
  growth: { label: 'Growth', Icon: Ruler, get color() { return colors.greenSoft; }, bg: 'border-green/40 bg-green/10' },
  temperature: { label: 'Temperature', Icon: Thermometer, get color() { return colors.redSoft; }, bg: 'border-red/40 bg-red/10' },
  medication: { label: 'Medication', Icon: Pill, get color() { return colors.blueSoft; }, bg: 'border-blue/40 bg-blue/10' },
  potty: { label: 'Potty', Icon: Toilet, get color() { return colors.amberPale; }, bg: 'border-yellow/40 bg-yellow/10' },
  activity: { label: 'Activity', Icon: Activity, get color() { return colors.tealSoft; }, bg: 'border-teal/40 bg-teal/10' },
  milestone: { label: 'Milestone', Icon: Flag, get color() { return colors.orangeSoft; }, bg: 'border-orange/40 bg-orange/10' },
  note: { label: 'Note', Icon: NotebookPen, get color() { return colors.inkSoft; }, bg: 'border-gray/40 bg-gray/10' },
};

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
