import React from 'react';
import {
  describeDiaper,
  describeFeed,
  formatDuration,
  formatLength,
  formatTemperature,
  formatVolume,
  formatWeight,
  type LogEntry,
  type UnitSystem,
} from '@kindred-log/shared';
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
} from 'lucide-react-native';

export type LogDisplay = {
  icon: React.ReactNode;
  /** Tailwind border/background classes for the row. */
  bg: string;
  label: string;
  detail: string;
};

const ICON = 18;

/** Icon, colors and text for one log entry. `formatTime` renders clock times. */
export function logDisplay(
  entry: LogEntry,
  units: UnitSystem,
  formatTime: (ms: number) => string,
): LogDisplay {
  const p = entry.payload;
  const running = entry.endedAt === null;
  const span = entry.endedAt !== null && entry.endedAt > entry.startedAt
    ? `${formatTime(entry.startedAt)} → ${formatTime(entry.endedAt)}`
    : '';

  switch (p.type) {
    case 'diaper':
      return {
        icon: <Droplets color="#fbbf24" size={ICON} />,
        bg: 'border-amber-500/40 bg-amber-500/10',
        label: `Diaper — ${describeDiaper(p)}`,
        detail: p.notes ?? '',
      };
    case 'feed':
      return {
        icon: <Baby color="#67e8f9" size={ICON} />,
        bg: 'border-cyan-500/40 bg-cyan-500/10',
        label: running
          ? 'Feeding…'
          : p.method === 'bottle' && p.amountMl !== undefined
            ? describeFeed({ ...p, amountMl: undefined }) + ` · ${formatVolume(p.amountMl, units)}`
            : describeFeed(p),
        detail: running ? '(ongoing)' : span,
      };
    case 'sleep':
      return {
        icon: <Moon color="#a78bfa" size={ICON} />,
        bg: 'border-violet-500/40 bg-violet-500/10',
        label: running ? 'Sleeping…' : p.nap === false ? 'Night sleep' : 'Nap',
        detail: running
          ? '(ongoing)'
          : `${formatDuration(entry.endedAt! - entry.startedAt)} · ${span}`,
      };
    case 'pumping':
      return {
        icon: <Milk color="#f0abfc" size={ICON} />,
        bg: 'border-fuchsia-500/40 bg-fuchsia-500/10',
        label: running
          ? 'Pumping…'
          : p.amountMl !== undefined ? `Pumped ${formatVolume(p.amountMl, units)}` : 'Pumped',
        detail: running ? '(ongoing)' : span,
      };
    case 'growth':
      return {
        icon: <Ruler color="#86efac" size={ICON} />,
        bg: 'border-green-500/40 bg-green-500/10',
        label: 'Growth',
        detail: [
          p.weightG !== undefined && formatWeight(p.weightG, units),
          p.heightCm !== undefined && formatLength(p.heightCm, units),
          p.headCm !== undefined && `head ${formatLength(p.headCm, units)}`,
        ].filter(Boolean).join(' · '),
      };
    case 'temperature':
      return {
        icon: <Thermometer color="#fca5a5" size={ICON} />,
        bg: 'border-red-500/40 bg-red-500/10',
        label: formatTemperature(p.celsius, units),
        detail: p.notes ?? '',
      };
    case 'medication':
      return {
        icon: <Pill color="#93c5fd" size={ICON} />,
        bg: 'border-blue-500/40 bg-blue-500/10',
        label: p.name,
        detail: p.dose !== undefined ? `${p.dose} ${p.unit ?? ''}`.trim() : '',
      };
    case 'potty':
      return {
        icon: <Toilet color="#fde68a" size={ICON} />,
        bg: 'border-yellow-500/40 bg-yellow-500/10',
        label: `Potty — ${p.result}${p.accident ? ' (accident)' : ''}`,
        detail: p.location ?? '',
      };
    case 'activity':
      return {
        icon: <Activity color="#5eead4" size={ICON} />,
        bg: 'border-teal-500/40 bg-teal-500/10',
        label: running ? `${activityLabel(p.kind)}…` : activityLabel(p.kind),
        detail: running ? '(ongoing)' : span || (p.milestone ?? ''),
      };
    case 'milestone':
      return {
        icon: <Flag color="#fdba74" size={ICON} />,
        bg: 'border-orange-500/40 bg-orange-500/10',
        label: p.custom ?? p.key ?? 'Milestone',
        detail: p.notes ?? '',
      };
    case 'note':
      return {
        icon: <NotebookPen color="#cbd5e1" size={ICON} />,
        bg: 'border-slate-500/40 bg-slate-500/10',
        label: p.text.split('\n')[0],
        detail: '',
      };
  }
}

export function activityLabel(kind: string): string {
  return kind === 'tummy_time' ? 'Tummy time' : kind.charAt(0).toUpperCase() + kind.slice(1);
}
