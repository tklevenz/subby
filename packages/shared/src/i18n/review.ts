/**
 * Messages a native speaker reviews in every language before a release (A14): where a wrong word could lose data
 * or hurt (recovery key, medication, deleting, the medical disclaimer). A key, or a prefix ending in ".".
 * `i18n.test.ts` checks that each entry still matches a key.
 */
export const REVIEW_KEYS: readonly string[] = [
  // The recovery key: the only way back if every phone is lost.
  'recovery.',
  'recover.',
  'syncScreen.onlyThisPhone',
  'syncScreen.everyPhoneLost',
  'syncScreen.lostPaper',
  'nudge.',
  // Medication: never a second dose by mistake.
  'reminder.med.',
  'editor.dose',
  'editor.nextDose',
  'home.overdue',
  'home.dueAt',
  'home.dueTomorrow',
  // Deleting and leaving: what's gone and what stays.
  'childEdit.',
  'entry.deleteTitle',
  'entry.deleteText',
  'night.deleteWhole',
  'night.deleteSleep',
  'home.discardTitle',
  'home.discardText',
  'syncScreen.offTitle',
  'syncScreen.offLast',
  'syncScreen.offLeave',
  'syncScreen.removeTitle',
  'syncScreen.removeText',
  'syncScreen.removedText',
  'join.replace',
  'join.replaceNote',
  'move.confirmText',
  'sync.inactive.',
  'sync.newPhone.body',
  'backup.forget',
  'backup.noPassphrase',
  'export.notEncrypted',
  // Not medical advice.
  'schedule.disclaimer',
  'growth.setSex',
];
