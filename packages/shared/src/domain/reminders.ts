import { t } from '../i18n';
import type { LogType } from '../schemas/log.schema';
import type { MedicationDue } from './recent';
import type { SleepPrediction } from './prediction';
import { formatHoursMinutes } from './time';

/** Device-local reminder preferences (each caregiver chooses their own). */
export type ReminderSettings = {
  /** Master switch: pauses every reminder without losing the per-kind choices. */
  enabled: boolean;
  feed: { enabled: boolean; intervalMin: number };
  diaper: { enabled: boolean; intervalMin: number };
  pumping: { enabled: boolean; intervalMin: number };
  medication: { enabled: boolean };
  nap: { enabled: boolean; leadMin: number };
  /** "Still running?" for timers left on far longer than usual. */
  timers: { enabled: boolean };
};

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: true,
  feed: { enabled: false, intervalMin: 180 },
  diaper: { enabled: false, intervalMin: 180 },
  pumping: { enabled: false, intervalMin: 180 },
  medication: { enabled: false },
  nap: { enabled: false, leadMin: 10 },
  timers: { enabled: false },
};

export type ReminderKind = Exclude<keyof ReminderSettings, 'enabled'>;
export const REMINDER_KINDS: readonly ReminderKind[] = ['feed', 'diaper', 'pumping', 'medication', 'nap', 'timers'];

/** How many reminder kinds are switched on (0 when paused). */
export function activeReminderCount(s: ReminderSettings): number {
  return s.enabled ? REMINDER_KINDS.filter((k) => s[k].enabled).length : 0;
}

/** When a running timer is probably forgotten, by type (sleep: nap vs night). */
export const FORGOTTEN_TIMER_MIN: Partial<Record<LogType, number>> & { nap: number; night: number } = {
  feed: 60,
  pumping: 45,
  activity: 90,
  nap: 180,
  night: 14 * 60,
};

export type RunningTimer = { id: string; type: LogType; startedAt: number; nap?: boolean };

export type ReminderChild = {
  id: string;
  name: string;
  /** Start of the last completed feed. */
  lastFeedAt: number | null;
  feedRunning: boolean;
  lastDiaperAt: number | null;
  /** Start of the last completed pumping session. */
  lastPumpAt: number | null;
  timers: RunningTimer[];
  meds: MedicationDue[];
  nextSleep: SleepPrediction | null;
};

export type PlannedNotification = {
  /** Stable per reminder, so rescheduling replaces rather than duplicates. */
  id: string;
  at: number;
  title: string;
  body: string;
  childId: string;
  /** Entry to open when tapped (forgotten timers). */
  entryId?: string;
};

export const REMINDER_ID_PREFIX = 'kl:';

const hm = (min: number) => formatHoursMinutes(min * 60_000);

/** Local notifications to have scheduled right now. Anything already due is left out. */
export function planReminders(input: {
  now: number;
  settings: ReminderSettings;
  children: ReminderChild[];
  formatTime: (ms: number) => string;
  /**
   * Another phone may log a dose that this phone only learns about when the app opens (sync without push).
   * Medication reminders then say to check first, so nobody gives a second dose by mistake.
   */
  checkBeforeDosing?: boolean;
}): PlannedNotification[] {
  const { now, settings, children, formatTime, checkBeforeDosing } = input;
  const out: PlannedNotification[] = [];
  if (!settings.enabled) return out;
  const add = (n: PlannedNotification) => {
    if (n.at > now + 5_000) out.push(n);
  };

  for (const c of children) {
    if (settings.feed.enabled && c.lastFeedAt !== null && !c.feedRunning) {
      add({
        id: `${REMINDER_ID_PREFIX}feed:${c.id}`,
        at: c.lastFeedAt + settings.feed.intervalMin * 60_000,
        title: t('reminder.feed.title', { name: c.name }),
        body: t('reminder.feed.body', { span: hm(settings.feed.intervalMin), time: formatTime(c.lastFeedAt) }),
        childId: c.id,
      });
    }

    if (settings.diaper.enabled && c.lastDiaperAt !== null) {
      add({
        id: `${REMINDER_ID_PREFIX}diaper:${c.id}`,
        at: c.lastDiaperAt + settings.diaper.intervalMin * 60_000,
        title: t('reminder.diaper.title', { name: c.name }),
        body: t('reminder.diaper.body', { span: hm(settings.diaper.intervalMin), time: formatTime(c.lastDiaperAt) }),
        childId: c.id,
      });
    }

    const pumpRunning = c.timers.some((t) => t.type === 'pumping');
    if (settings.pumping.enabled && c.lastPumpAt !== null && !pumpRunning) {
      add({
        id: `${REMINDER_ID_PREFIX}pumping:${c.id}`,
        at: c.lastPumpAt + settings.pumping.intervalMin * 60_000,
        title: t('reminder.pumping.title'),
        body: t('reminder.pumping.body', { span: hm(settings.pumping.intervalMin), time: formatTime(c.lastPumpAt) }),
        childId: c.id,
      });
    }

    if (settings.timers.enabled) {
      for (const timer of c.timers) {
        const limit = timer.type === 'sleep' ? (timer.nap ? FORGOTTEN_TIMER_MIN.nap : FORGOTTEN_TIMER_MIN.night) : FORGOTTEN_TIMER_MIN[timer.type];
        if (limit === undefined) continue;
        const what = timer.type === 'sleep' ? (timer.nap ? 'nap' : 'sleep') : timer.type === 'feed' ? 'feed' : timer.type === 'pumping' ? 'pumping' : 'activity';
        add({
          id: `${REMINDER_ID_PREFIX}timer:${timer.id}`,
          at: timer.startedAt + limit * 60_000,
          title: t(`reminder.timer.title.${what}`, { name: c.name }),
          body: t('reminder.timer.body', { span: hm(limit), time: formatTime(timer.startedAt) }),
          childId: c.id,
          entryId: timer.id,
        });
      }
    }

    if (settings.medication.enabled) {
      for (const m of c.meds) {
        // Doses far apart are probably finished courses, not a schedule.
        if (m.dueAt - m.lastAt > 2 * 24 * 3_600_000) continue;
        add({
          id: `${REMINDER_ID_PREFIX}med:${c.id}:${m.name.trim().toLowerCase()}`,
          at: m.dueAt,
          title: t('reminder.med.title', { medication: m.name, name: c.name }),
          body: t(checkBeforeDosing ? 'reminder.med.bodyCheck' : 'reminder.med.body', { time: formatTime(m.lastAt) }),
          childId: c.id,
        });
      }
    }

    if (settings.nap.enabled && c.nextSleep) {
      const s = c.nextSleep;
      const what = t(s.kind === 'bedtime' ? 'reminder.sleep.bedtime' : s.kind === 'sleep' ? 'reminder.sleep.sleep' : 'reminder.sleep.nap');
      add({
        id: `${REMINDER_ID_PREFIX}nap:${c.id}`,
        at: s.earliest - settings.nap.leadMin * 60_000,
        title: settings.nap.leadMin
          ? t('reminder.sleep.titleIn', { what, name: c.name, count: settings.nap.leadMin })
          : t('reminder.sleep.titleNow', { what, name: c.name }),
        body: t('reminder.sleep.body', { what, from: formatTime(s.earliest), to: formatTime(s.latest) }),
        childId: c.id,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
