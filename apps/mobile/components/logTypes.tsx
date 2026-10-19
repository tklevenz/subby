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

export type LogTypeMeta = {
  label: string;
  Icon: ComponentType<LucideProps>;
  color: string;
  /** Tailwind border/background classes for rows and tiles. */
  bg: string;
};

export const TYPE_META: Record<LogType, LogTypeMeta> = {
  feed: { label: 'Feed', Icon: Baby, color: '#67e8f9', bg: 'border-cyan-500/40 bg-cyan-500/10' },
  diaper: { label: 'Diaper', Icon: Droplets, color: '#fbbf24', bg: 'border-amber-500/40 bg-amber-500/10' },
  sleep: { label: 'Sleep', Icon: Moon, color: '#a78bfa', bg: 'border-violet-500/40 bg-violet-500/10' },
  pumping: { label: 'Pumping', Icon: Milk, color: '#f0abfc', bg: 'border-fuchsia-500/40 bg-fuchsia-500/10' },
  growth: { label: 'Growth', Icon: Ruler, color: '#86efac', bg: 'border-green-500/40 bg-green-500/10' },
  temperature: { label: 'Temperature', Icon: Thermometer, color: '#fca5a5', bg: 'border-red-500/40 bg-red-500/10' },
  medication: { label: 'Medication', Icon: Pill, color: '#93c5fd', bg: 'border-blue-500/40 bg-blue-500/10' },
  potty: { label: 'Potty', Icon: Toilet, color: '#fde68a', bg: 'border-yellow-500/40 bg-yellow-500/10' },
  activity: { label: 'Activity', Icon: Activity, color: '#5eead4', bg: 'border-teal-500/40 bg-teal-500/10' },
  milestone: { label: 'Milestone', Icon: Flag, color: '#fdba74', bg: 'border-orange-500/40 bg-orange-500/10' },
  note: { label: 'Note', Icon: NotebookPen, color: '#cbd5e1', bg: 'border-slate-500/40 bg-slate-500/10' },
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
