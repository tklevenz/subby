import React from 'react';
import {
  describeDiaper,
  describeFeed,
  formatDose,
  formatSpan,
  formatLength,
  formatTemperature,
  formatVolume,
  formatWeight,
  milestoneLabel,
  type LogEntry,
  type UnitSystem,
} from '@subby/shared';
import { TYPE_META, activityLabel, diaperLook } from './logTypes';
import { ChildReaching } from './icons';

export { activityLabel };

export type LogDisplay = {
  icon: React.ReactNode;
  /** The icon's color (History's ring around it). */
  color: string;
  /** Tailwind border/background classes for the row. */
  bg: string;
  label: string;
  detail: string;
};

/** Icon, colors and text for one log entry. `formatTime` renders clock times. */
export function logDisplay(
  entry: LogEntry,
  units: UnitSystem,
  formatTime: (ms: number) => string,
): LogDisplay {
  const p = entry.payload;
  const { bg } = TYPE_META[p.type];
  // Diapers look like the diaper sheet's buttons; tummy time keeps its own icon (as on Home), other activities the generic one.
  const { Icon, color } =
    p.type === 'diaper'
      ? diaperLook(p.condition)
      : { Icon: p.type === 'activity' && p.kind === 'tummy_time' ? ChildReaching : TYPE_META[p.type].Icon, color: TYPE_META[p.type].color };
  const running = entry.endedAt === null;
  const span = entry.endedAt !== null && entry.endedAt > entry.startedAt
    ? `${formatTime(entry.startedAt)} → ${formatTime(entry.endedAt)}`
    : '';
  const withNotes = (detail: string) => [detail, p.notes].filter(Boolean).join(' · ');

  const text = ((): { label: string; detail: string } => {
    switch (p.type) {
      case 'diaper':
        return { label: `Diaper · ${describeDiaper(p)}`, detail: withNotes('') };
      case 'feed':
        if (running) return { label: 'Feeding…', detail: '(ongoing)' };
        return {
          label: p.method === 'bottle' && p.amountMl !== undefined
            ? `${describeFeed({ ...p, amountMl: undefined })} · ${formatVolume(p.amountMl, units)}`
            : describeFeed(p),
          detail: withNotes([span, p.allergen ? 'allergen' : '', p.reaction ?? ''].filter(Boolean).join(' · ')),
        };
      case 'sleep':
        if (running) return { label: 'Sleeping…', detail: '(ongoing)' };
        return {
          label: p.nap === false ? 'Night sleep' : 'Nap',
          detail: withNotes(`${formatSpan(entry.endedAt! - entry.startedAt)} · ${span}`),
        };
      case 'pumping':
        if (running) return { label: 'Pumping…', detail: '(ongoing)' };
        return {
          label: p.amountMl !== undefined ? `Pumped ${formatVolume(p.amountMl, units)}` : 'Pumped',
          detail: withNotes(span),
        };
      case 'growth':
        return {
          label: 'Growth',
          detail: withNotes([
            p.weightG !== undefined && formatWeight(p.weightG, units),
            p.heightCm !== undefined && formatLength(p.heightCm, units),
            p.headCm !== undefined && `head ${formatLength(p.headCm, units)}`,
          ].filter(Boolean).join(' · ')),
        };
      case 'temperature':
        return { label: formatTemperature(p.celsius, units), detail: withNotes('') };
      case 'medication':
        return { label: p.name, detail: withNotes(p.dose !== undefined ? formatDose(p.dose, p.unit) : '') };
      case 'potty':
        return {
          label: `Potty · ${p.result}${p.accident ? ' (accident)' : ''}`,
          detail: withNotes(p.location ?? ''),
        };
      case 'activity':
        if (running) return { label: `${activityLabel(p.kind)}…`, detail: '(ongoing)' };
        return {
          label: activityLabel(p.kind),
          detail: withNotes([span && formatSpan(entry.endedAt! - entry.startedAt), p.milestone].filter(Boolean).join(' · ')),
        };
      case 'milestone':
        return { label: p.custom ?? (p.key ? milestoneLabel(p.key) : 'Milestone'), detail: withNotes('') };
      case 'note':
        return { label: p.text.split('\n')[0], detail: p.photoUri ? '📷 photo' : '' };
    }
  })();

  return { icon: <Icon color={color} size={18} />, color, bg, ...text };
}
