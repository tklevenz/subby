import { t } from '@subby/shared/i18n';
import React from 'react';
import type { LogPayload } from '@subby/shared';
import { FieldLabel, TextField } from '../ui';

/** Fields every entry has beside its own editor, shared by the log sheet and the edit screen: notes (a note is its own text). */
export function CommonFields({ payload, onChange }: { payload: LogPayload; onChange: (p: Partial<LogPayload>) => void }) {
  if (payload.type === 'note') return null;
  return (
    <>
      <FieldLabel>{t('logSheet.notes')}</FieldLabel>
      <TextField
        value={payload.notes ?? ''}
        onChangeText={(notes) => onChange({ notes: notes || undefined })}
        placeholder={t('logSheet.optional')}
        multiline
        style={{ minHeight: 56, textAlignVertical: 'top' }}
      />
    </>
  );
}
