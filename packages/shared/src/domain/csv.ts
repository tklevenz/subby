import type { LogEntry, LogPayload } from '../schemas/log.schema';
import { milestoneLabel } from './milestones';

type Value = string | number | boolean | undefined;

const minutes = (sec: number | undefined) => (sec === undefined ? undefined : Math.round((sec / 60) * 10) / 10);
const list = (v: string[] | undefined) => (v?.length ? v.join('; ') : undefined);

/**
 * Payload columns, in output order. Values are canonical units, named in the header.
 * Only columns that have a value in at least one exported row are written.
 */
const COLUMNS: [header: string, get: (p: LogPayload) => Value][] = [
  ['method', (p) => (p.type === 'feed' ? p.method : undefined)],
  ['milk_type', (p) => (p.type === 'feed' ? p.milkType : undefined)],
  ['amount_ml', (p) => (p.type === 'feed' || p.type === 'pumping' ? p.amountMl : undefined)],
  ['left_min', (p) => (p.type === 'feed' ? minutes(p.leftSeconds) : undefined)],
  ['right_min', (p) => (p.type === 'feed' ? minutes(p.rightSeconds) : undefined)],
  ['last_side', (p) => (p.type === 'feed' ? p.lastSide : undefined)],
  ['left_ml', (p) => (p.type === 'pumping' ? p.leftMl : undefined)],
  ['right_ml', (p) => (p.type === 'pumping' ? p.rightMl : undefined)],
  ['foods', (p) => (p.type === 'feed' ? list(p.foods) : undefined)],
  ['reaction', (p) => (p.type === 'feed' ? p.reaction : undefined)],
  ['allergen', (p) => (p.type === 'feed' ? p.allergen : undefined)],
  ['feeder', (p) => (p.type === 'feed' ? p.feeder : undefined)],
  ['condition', (p) => (p.type === 'diaper' ? p.condition : undefined)],
  ['color', (p) => (p.type === 'diaper' ? p.color : undefined)],
  ['diaper_amount', (p) => (p.type === 'diaper' ? p.amount : undefined)],
  ['nap', (p) => (p.type === 'sleep' ? p.nap : undefined)],
  ['weight_g', (p) => (p.type === 'growth' ? p.weightG : undefined)],
  ['height_cm', (p) => (p.type === 'growth' ? p.heightCm : undefined)],
  ['head_cm', (p) => (p.type === 'growth' ? p.headCm : undefined)],
  ['temperature_c', (p) => (p.type === 'temperature' ? p.celsius : undefined)],
  ['medication', (p) => (p.type === 'medication' ? p.name : undefined)],
  ['dose', (p) => (p.type === 'medication' ? p.dose : undefined)],
  ['dose_unit', (p) => (p.type === 'medication' ? p.unit : undefined)],
  ['next_dose_interval_min', (p) => (p.type === 'medication' ? p.nextDoseIntervalMin : undefined)],
  ['result', (p) => (p.type === 'potty' ? p.result : undefined)],
  ['location', (p) => (p.type === 'potty' ? p.location : undefined)],
  ['accident', (p) => (p.type === 'potty' ? p.accident : undefined)],
  ['activity', (p) => (p.type === 'activity' ? p.kind : undefined)],
  ['milestone', (p) =>
    p.type === 'activity' ? p.milestone
      : p.type === 'milestone' ? (p.custom ?? (p.key ? milestoneLabel(p.key) : undefined))
        : undefined],
  ['text', (p) => (p.type === 'note' ? p.text : undefined)],
  ['notes', (p) => p.notes],
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local time as `YYYY-MM-DD HH:MM`, which spreadsheets parse as a date-time. */
export function csvDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * RFC 4180 quoting; text starting with = + - @ | (after any leading whitespace) or a tab or line break is prefixed
 * with ' so spreadsheets don't run it as a formula.
 */
export function csvCell(v: Value): string {
  if (v === undefined) return '';
  if (typeof v !== 'string') return String(v);
  const safe = /^(\s|[=+\-@|])/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One CSV of entries (any mix of types), oldest first. */
export function logsToCsv(logs: LogEntry[], childName: string): string {
  const rows = [...logs].filter((l) => !l.isDeleted).sort((a, b) => a.startedAt - b.startedAt);
  const used = COLUMNS.filter(([, get]) => rows.some((l) => get(l.payload) !== undefined));
  const header = ['child', 'type', 'start', 'end', 'duration_min', ...used.map(([h]) => h)];
  const lines = [header.join(',')];
  for (const l of rows) {
    const timed = l.endedAt !== null && l.endedAt > l.startedAt;
    lines.push(
      [
        childName,
        l.logType,
        csvDateTime(l.startedAt),
        timed ? csvDateTime(l.endedAt!) : undefined,
        timed ? Math.round((l.endedAt! - l.startedAt) / 6000) / 10 : undefined,
        ...used.map(([, get]) => get(l.payload)),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}
