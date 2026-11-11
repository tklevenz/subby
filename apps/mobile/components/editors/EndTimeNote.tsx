import { t } from '@subby/shared/i18n';
import React from 'react';
import { Text } from 'react-native';
import { endBeforeStart, formatHoursMinutes } from '@subby/shared';
import { ErrorText } from '../ui';

/**
 * The line under an end time: what's wrong with it (before the start, or overlapping another sleep), else how long
 * it lasts. With no end yet it shows `whenOpen` if given (the log sheet's "needs an end"), else nothing.
 */
export function EndTimeNote({ startedAt, endedAt, overlap, whenOpen }: { startedAt: number; endedAt: number | null; overlap: string | null; whenOpen?: string }) {
  if (endBeforeStart(startedAt, endedAt)) return <ErrorText className="mt-2">{t('logSheet.endBeforeStart')}</ErrorText>;
  if (overlap) return <ErrorText className="mt-2">{overlap}</ErrorText>;
  if (endedAt === null) return whenOpen ? <Text className="text-ink-muted text-sm mt-2">{whenOpen}</Text> : null;
  return <Text className="text-ink-muted text-sm mt-2">{formatHoursMinutes(endedAt - startedAt)}</Text>;
}
