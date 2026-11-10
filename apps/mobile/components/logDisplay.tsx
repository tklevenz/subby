import { t } from '@subby/shared/i18n';
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
    ? t('row.span', { from: formatTime(entry.startedAt), to: formatTime(entry.endedAt) })
    : '';
  const dot = (...parts: (string | false | undefined | null)[]) => parts.filter(Boolean).join(' · ');
  const withNotes = (detail: string) => dot(detail, p.notes);
  const ongoing = t('row.ongoing');

  const text = ((): { label: string; detail: string } => {
    switch (p.type) {
      case 'diaper':
        return { label: t('row.diaper', { detail: describeDiaper(p) }), detail: withNotes('') };
      case 'feed':
        if (running) return { label: t('row.feeding'), detail: ongoing };
        return {
          label: p.method === 'bottle' && p.amountMl !== undefined
            ? dot(describeFeed({ ...p, amountMl: undefined }), formatVolume(p.amountMl, units))
            : describeFeed(p),
          detail: withNotes(dot(span, p.allergen && t('row.allergen'), p.reaction)),
        };
      case 'sleep':
        if (running) return { label: t('row.sleeping'), detail: ongoing };
        return {
          label: t(p.nap === false ? 'row.nightSleep' : 'row.nap'),
          detail: withNotes(dot(formatSpan(entry.endedAt! - entry.startedAt), span)),
        };
      case 'pumping':
        if (running) return { label: t('row.pumpingRunning'), detail: ongoing };
        return {
          label: p.amountMl !== undefined ? t('row.pumpedAmount', { amount: formatVolume(p.amountMl, units) }) : t('row.pumped'),
          detail: withNotes(span),
        };
      case 'growth':
        return {
          label: t('type.growth'),
          detail: withNotes(dot(
            p.weightG !== undefined && formatWeight(p.weightG, units),
            p.heightCm !== undefined && formatLength(p.heightCm, units),
            p.headCm !== undefined && t('story.head', { length: formatLength(p.headCm, units) }),
          )),
        };
      case 'temperature':
        return { label: formatTemperature(p.celsius, units), detail: withNotes('') };
      case 'medication':
        return { label: p.name, detail: withNotes(p.dose !== undefined ? formatDose(p.dose, p.unit) : '') };
      case 'potty':
        return {
          label: t(p.accident ? 'row.pottyAccident' : 'row.potty', { result: t(`potty.${p.result}`) }),
          detail: withNotes(p.location ? t(`potty.${p.location}`) : ''),
        };
      case 'activity':
        if (running) return { label: t('row.running', { what: activityLabel(p.kind) }), detail: ongoing };
        return {
          label: activityLabel(p.kind),
          detail: withNotes(dot(span && formatSpan(entry.endedAt! - entry.startedAt), p.milestone)),
        };
      case 'milestone':
        return { label: p.custom ?? (p.key ? milestoneLabel(p.key) : t('type.milestone')), detail: withNotes('') };
      case 'note':
        return { label: p.text.split('\n')[0], detail: p.photoUri ? t('row.photo') : '' };
    }
  })();

  return { icon: <Icon color={color} size={18} />, color, bg, ...text };
}
