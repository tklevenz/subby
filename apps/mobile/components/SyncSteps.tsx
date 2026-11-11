import { t } from '@subby/shared/i18n';
import React from 'react';
import { Button, ErrorText, Hint, Lead, LoaderBlock, ScreenTitle } from './ui';
import { useSyncStore } from '../features/sync/state';

/** "Downloading photos · 120": what a sync run reports while it works. */
export const progressLabel = (progress: { label: string; done: number }) => t('syncScreen.progress', { label: progress.label, count: progress.done });

/** The wait while joining or recovering: the run's own progress when it has one, else `label`. */
export function SyncBusy({ label }: { label: string }) {
  const progress = useSyncStore((s) => s.progress);
  return <LoaderBlock label={progress ? progressLabel(progress) : label} />;
}

/** This phone has entries of its own: replace them with the family's, or add them to it. Shared by Join and Recover. */
export function ReplaceOrMerge({ lead, onReplace, onMerge }: { lead: string; onReplace: () => void; onMerge: () => void }) {
  return (
    <>
      <ScreenTitle>{t('join.hasEntries')}</ScreenTitle>
      <Lead className="mt-2">{lead}</Lead>
      <Button label={t('join.replace')} onPress={onReplace} />
      <Hint className="text-center">{t('join.replaceNote')}</Hint>
      <Button label={t('join.merge')} variant="ghost" onPress={onMerge} />
    </>
  );
}

/** A step that failed: what went wrong and a button to start over. */
export function FailedStep({ title, message, retryLabel, onRetry }: { title: string; message: string; retryLabel: string; onRetry: () => void }) {
  return (
    <>
      <ScreenTitle className="mt-4">{title}</ScreenTitle>
      <ErrorText className="mt-2">{message}</ErrorText>
      <Button label={retryLabel} onPress={onRetry} />
    </>
  );
}
