import { t } from '../i18n';
import type { LogEntry } from '../schemas/log.schema';
import { groupNights, isSleepEntry, nightOf } from './nights';
import { isNightWaking } from './prediction';
import { isNap } from './stats';
import { formatHoursMinutes } from './time';
import { formatDose } from './units';

/** Device-local: what this phone hears about when another phone in the family logs. Not a reminder: its own switch. */
export type FamilyAlertSettings = {
  /** A sleep starts. */
  enabled: boolean;
  /** It ends (replaces the "asleep" notification). */
  wakeUps: boolean;
  /** Bedtime and the morning too, not only naps. Night wakings never notify. */
  nights: boolean;
  /** A dose of medication is logged (on its own: no sleep alerts needed), so nobody gives it twice. */
  medications: boolean;
};

export const DEFAULT_FAMILY_ALERTS: FamilyAlertSettings = { enabled: false, wakeUps: true, nights: false, medications: false };

/** Presented right away (not scheduled), so kept apart from the reminder ids the scheduler replaces. */
export const FAMILY_ALERT_ID_PREFIX = 'kl-family:';

/** A pulled entry another phone wrote: this phone's copy before, and the new version. */
export type PulledChange = { before: LogEntry | null; after: LogEntry; by: string };

export type FamilyAlert =
  | { kind: 'show'; id: string; title: string; body: string; childId: string }
  | { kind: 'dismiss'; id: string };

const MIN = 60_000;
/** Older news isn't worth a notification: a sleep logged afterwards, or a pull hours late (no push). */
export const FAMILY_ALERT_RECENT_MS = 10 * MIN;
const DAY = 86_400_000;
/** A dose given longer ago than this isn't news, even when logged just now. */
const MED_RECENT_MS = 12 * 60 * MIN;

const isRunning = (l: LogEntry) => !l.isDeleted && l.endedAt === null;

/**
 * The notifications to show or withdraw for entries pulled from other phones. One per sleep (its id), so a
 * wake-up replaces "asleep", and an undone or deleted sleep takes its notification away. One per new dose of
 * medication (withdrawn if it's deleted); edits to a dose don't notify again. `sleeps(childId)` is
 * the child's recent sleeps after the pull (night wakings are told apart by them).
 */
export function familyAlerts(input: {
  changes: PulledChange[];
  settings: FamilyAlertSettings;
  /** Notifications allowed on this phone; without, nothing is shown (withdrawing still happens). */
  allowed: boolean;
  sleeps: (childId: string) => LogEntry[];
  childName: (childId: string) => string | undefined;
  now: number;
  formatTime: (ms: number) => string;
}): FamilyAlert[] {
  const { changes, settings, now, formatTime } = input;
  const on = input.allowed && settings.enabled;
  const out: FamilyAlert[] = [];

  for (const { before, after, by } of changes) {
    if (after.logType === 'medication') {
      const id = `${FAMILY_ALERT_ID_PREFIX}medication:${after.id}`;
      if (after.isDeleted) {
        out.push({ kind: 'dismiss', id });
        continue;
      }
      const p = after.payload;
      const name = input.childName(after.childId);
      // Only a dose just logged (not one an old pull brings, or an edit) given in the last 12 hours.
      if (p.type !== 'medication' || !name || before !== null || !input.allowed || !settings.medications) continue;
      if (now - after.updatedAt > FAMILY_ALERT_RECENT_MS || now - after.startedAt > MED_RECENT_MS) continue;
      const time = formatTime(after.startedAt);
      out.push({
        kind: 'show',
        id,
        title: t('family.medGiven', { name, medication: p.name }),
        body: p.dose !== undefined ? t('family.medDoseAt', { dose: formatDose(p.dose, p.unit), time, phone: by }) : t('family.medAt', { time, phone: by }),
        childId: after.childId,
      });
      continue;
    }
    if (after.logType !== 'sleep' || after.startedAt < now - DAY) continue;
    const id = `${FAMILY_ALERT_ID_PREFIX}sleep:${after.id}`;
    if (after.isDeleted || !isSleepEntry(after)) {
      out.push({ kind: 'dismiss', id });
      continue;
    }
    const was = before !== null && isRunning(before);
    const name = input.childName(after.childId);
    if (!name) continue;
    const nap = isNap(after);
    const sleeps = () => input.sleeps(after.childId);

    if (isRunning(after) && !was) {
      if (!on || now - after.startedAt > FAMILY_ALERT_RECENT_MS) continue;
      // Back asleep after a night waking: the night already notified.
      if (!nap && (!settings.nights || nightOf(groupNights(sleeps(), now), after.id)?.pieces[0]?.id !== after.id)) continue;
      out.push({
        kind: 'show',
        id,
        title: t(nap ? 'family.fellAsleep' : 'family.downForNight', { name }),
        body: t(nap ? 'family.napSince' : 'family.asleepSince', { time: formatTime(after.startedAt), phone: by }),
        childId: after.childId,
      });
    } else if (was && !isRunning(after)) {
      // Up in the night: the night isn't over, so nothing changes yet. Also when back asleep already (the waking
      // and the next piece arrived in one pull; isNightWaking is false then, a sleep is running).
      if (!nap && (isNightWaking(sleeps(), now) || sleeps().some((s) => isRunning(s) && s.startedAt >= after.endedAt!))) continue;
      // A night's notification belongs to its first piece, the one that said "down for the night".
      const night = nap ? undefined : nightOf(groupNights(sleeps(), now), after.id);
      const nightId = night ? `${FAMILY_ALERT_ID_PREFIX}sleep:${night.pieces[0]!.id}` : id;
      const fresh = now - after.endedAt! <= FAMILY_ALERT_RECENT_MS;
      if (on && settings.wakeUps && fresh && (nap || settings.nights)) {
        out.push({
          kind: 'show',
          id: nightId,
          title: t('family.wokeUp', { name }),
          body: t(nap ? 'family.napped' : 'family.slept', { span: formatHoursMinutes(night?.asleepMs ?? after.endedAt! - after.startedAt), phone: by }),
          childId: after.childId,
        });
      } else out.push({ kind: 'dismiss', id: nightId });
    }
  }
  return out;
}
