---
paths:
  - "packages/shared/src/domain/**"
  - "packages/shared/src/schemas/**"
  - "packages/shared/src/__tests__/**"
---

# `packages/shared`: schemas and domain logic

- `src/schemas/log.schema.ts`: `LogEntry` + discriminated `LogPayload` union (feed, diaper, sleep, pumping, growth, temperature, medication, potty, activity, milestone, note). Canonical units only: ml, g, cm, °C, seconds, epoch ms.
- `src/schemas/child.schema.ts`: `Child`.
- `src/domain/`: pure, RN-free helpers. Put new business logic here and test it with vitest (`src/__tests__`). The tests run with `TZ=Europe/Berlin` (package.json), so `dst.test.ts` and other DST cases cross real clock changes on any machine.

## Modules
- `units` (`formatDose`: "1 drop"), `time` (`formatDuration` for live timers, with seconds; `formatSpan` for finished entries, no seconds from a minute up; a zero part is dropped: "2h"), `summary`, `validate` (`isCompletePayload` gates Save).
- `feedTimer`: breastfeeding L/R timer state lives in the feed payload (`timerSide`, `timerSideSince`); `toggleSide`/`pauseFeed`.
- `recent` (food/medication suggestions, `medicationsDue` (with the last dose, to log the next like it), `pumpingDue` (the pumping reminder's time)), `milestones` (bundled checklist).
- `stats` (`dailyStats` per-day totals, splitting sleep across midnight; `averageStats` over tracked days; `sleepSegments`; `solidsReport`; DST-safe `addDays`/`dayRange`).
- `growth`: WHO LMS z-scores/percentiles (0–24 months, from the birth date; corrected age for preterm babies was dropped on purpose, and `dueDate` is stored but unused), `percentileCurves`. The tables in `domain/who/lms.ts` are generated from the CDC-hosted WHO CSVs; don't edit them by hand.
- `timeline`: `dayTimeline` (History's Day: entries newest first, a sleep running into the day from the evening before, wake windows of a minute or more between sleeps, today's current one first; a night with wakings is one `night` item).
- `nights`: a night is stored as its pieces, never as one entry with wakings inside. `groupNights` puts night sleeps (not naps) less than `NIGHT_GAP_MS` (3 h) apart into one `Night` (pieces, wakings, time asleep, longest stretch); prediction merges nights by the same rule. `nightPieces` turns an edited bedtime, wake-up and wakings back into pieces; `nightsByDay`/`averageNights` feed Trends (each day's night is the one that ended that morning).
- `summary` also has `overlappingSleep` (a sleep may not overlap another; running ones last until stopped). The log sheet and the edit screen block overlaps via `apps/mobile/features/sleepOverlap.ts` (a week of sleeps from SQLite plus the loaded ones).
- `reminders`: `planReminders` (pure) turns `ReminderSettings` + per-child state into the notifications to schedule (stable `kl:` ids).
- `familyAlerts`: what to show or withdraw when a pull brings sleeps another phone logged (`kl-family:sleep:<id>`, one per sleep or night, so "woke up" replaces "fell asleep" and an undone sleep takes it away). Naps by default; bedtime and the morning only when asked; never night wakings, nor anything over 10 min old. With `medications` (its own switch, independent of the sleep ones), a new dose another phone logged (`kl-family:medication:<id>`: logged in the last 10 min, given in the last 12 h; edits don't notify, a deletion withdraws it), so nobody gives it twice.
- `story`: `childStory` builds a child's story of firsts (milestones, measurements, first solid food, birth), newest first. No counts or completion: we don't gamify childcare.
- `csv`: `logsToCsv` (one file, mixed types, only used columns, formula-injection safe).
- `babybuddy`: Baby Buddy record types, `mapRecord` (BB → payload), `detectUnits` (BB stores no units; e.g. weight may be g or kg), `bbRef` import refs.

## Prediction (`prediction`)
On-device nap prediction. Heuristic, verified against the real Baby Buddy history.
- Age norms (`ageNorms`), plus `sleepHabits` (the last 7 days; night sleep logged in pieces is merged into one night).
- `predictNextSleep`: put-down window, ±30 min from personal data, plus `napMinutes`, the expected nap length. Nothing while `isNightWaking`: awake after a night sleep that ended ≥90 min before the usual wake-up, until that wake-up or 3 h, after which it was the day's start.
- `suggestedSchedule`: today's logged wake-up, naps and started bedtime as `logged` items, the rest predicted from the last one. A nap that would run into bedtime is left out: one starting within 90 min of it, or ending without ¾ of the shortest wake window left. Bedtime is the baby's usual one, else the age norm's (`AgeNorms.bedtime`, 19:30 from 3 months), so a day without history doesn't end mid-afternoon.
- Under 3 months, until a few nights are logged, there's no planned day (`planned: false`) and no bedtime: `predictNextSleep` gives `kind: 'sleep'` ("Next sleep", no nap number; null once its window has passed, since newborn naps go unlogged; with logged nights, null until bedtime is next instead of jumping to it), and the Schedule screen explains that newborns don't keep a schedule yet. With logged nights, a newborn's day fills with naps up to the bedtime (the logged nap count is ignored, since newborn naps go unlogged).
- `defaultNap` is the default nap flag (Home's sleep tile, and the log sheet until the toggle is used): night from an hour before the usual bedtime until the usual wake-up, else `isNapTime` (07–19h) until enough nights are logged.
- Replayed on two years of real sleeps: longer windows (14–28 days, or recency-weighted) and predicting naps by clock time were no better than 7 days; a nap counts while ≥30 % of days have it (`NAP_DAY_SHARE`).

## Backup (`backup`, import from `@subby/shared/domain/backup`, kept off the main index)
- The file is a zip (`fflate`) holding `backup.json` (children, entries and tombstones) plus `photos/<n>.<ext>`. Photo names are ours, never taken from row data. Device-local fields stay out: photo paths, `photoBlob`, sync status.
- An optional passphrase encrypts it: `KLBK` header with scrypt parameters and salt, then `encryptFile`. The parameters are read from the header and bounded (≤ 64 MiB of scrypt memory).
- Reading unzips only `backup.json` and `photos/<n>.<ext>`, and refuses a zip that would inflate past its size + 64 MiB.
- `readBackup` validates each row and skips (and counts) bad ones; payloads are checked with `LenientPayloadSchema` (log.schema: each known field's primitive type and required fields, no value checks, unknown fields pass). It also accepts the old `kindred-log-backup` format name; keep that.
- `planRestore` uses newest-edit-wins, like sync, after keeping one version per row (the newest, live or deleted). What was deleted here since the backup is offered separately (`plan.revive`, dated after the deletion so sync spreads it; an entry only with its child, so a deleted child comes back with its entries), and only restored when the person turns on "Bring them back" in the preview (off by default: with sync it comes back on every phone).
