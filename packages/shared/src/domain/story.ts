import { t } from '../i18n';
import type { Child } from '../schemas/child.schema';
import type { LogEntry } from '../schemas/log.schema';
import { milestoneLabel } from './milestones';
import { formatLength, formatWeight, type UnitSystem } from './units';

export type StoryItem = {
  /** Stable key: the entry id, or 'birth'. */
  id: string;
  /** Entry to open on tap; null for the birth item. */
  logId: string | null;
  at: number;
  kind: 'birth' | 'milestone' | 'growth' | 'solids';
  title: string;
};

/** Local midnight of an ISO date (YYYY-MM-DD). */
function isoDateMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * A child's story of firsts, newest first: milestones, measurements, the first solid food
 * and the birth. Plain events, no counts or completion (we don't score children).
 * `logs` may be in any order and should hold the child's milestone, growth and solids entries.
 */
export function childStory(logs: LogEntry[], child: Pick<Child, 'birthDate'>, units: UnitSystem): StoryItem[] {
  const items: StoryItem[] = [];
  let firstSolids: LogEntry | null = null;

  for (const l of logs) {
    if (l.isDeleted) continue;
    const p = l.payload;
    if (p.type === 'milestone') {
      const title = p.custom?.trim() || (p.key ? milestoneLabel(p.key) : null);
      if (title) items.push({ id: l.id, logId: l.id, at: l.startedAt, kind: 'milestone', title });
    } else if (p.type === 'growth') {
      const parts = [
        p.weightG ? formatWeight(p.weightG, units) : null,
        p.heightCm ? formatLength(p.heightCm, units) : null,
        p.headCm ? t('story.head', { length: formatLength(p.headCm, units) }) : null,
      ].filter(Boolean);
      if (parts.length) items.push({ id: l.id, logId: l.id, at: l.startedAt, kind: 'growth', title: t('story.measured', { parts: parts.join(t('list.join')) }) });
    } else if (p.type === 'feed' && p.foods?.length && (!firstSolids || l.startedAt < firstSolids.startedAt)) {
      firstSolids = l;
    }
  }

  if (firstSolids?.payload.type === 'feed') {
    const foods = firstSolids.payload.foods!.join(t('list.join'));
    items.push({ id: firstSolids.id, logId: firstSolids.id, at: firstSolids.startedAt, kind: 'solids', title: t('story.firstSolids', { foods }) });
  }
  items.push({ id: 'birth', logId: null, at: isoDateMs(child.birthDate), kind: 'birth', title: t('story.born') });

  return items.sort((a, b) => b.at - a.at);
}
