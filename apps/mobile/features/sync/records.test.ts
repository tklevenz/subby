import { describe, expect, it } from 'vitest';
import type { Child, LogEntry } from '@kindred-log/shared';
import { bodyToChild, bodyToLog, childToBody, logToBody } from './records';

const child: Child = {
  id: '0190a000-0000-7000-8000-000000000000',
  name: 'Sam',
  birthDate: '2024-07-27',
  birthTime: '08:15',
  dueDate: null,
  sex: 'male',
  photoUri: 'file:///data/photos/1.jpg',
  updatedAt: 1000,
  isDeleted: false,
  syncStatus: 'pending',
  importRef: 'babybuddy:bb.example:children:1',
};

const note: LogEntry = {
  id: '0190a000-0000-7000-8000-000000000001',
  childId: child.id,
  logType: 'note',
  startedAt: 500,
  endedAt: null,
  createdBy: null,
  payload: { type: 'note', text: 'First smile', photoUri: 'file:///data/photos/2.jpg' },
  updatedAt: 1000,
  isDeleted: false,
  syncStatus: 'pending',
  importRef: null,
};

describe('sync record bodies', () => {
  it('leave device-local fields out', () => {
    expect(childToBody(child)).toEqual({ name: 'Sam', birthDate: '2024-07-27', birthTime: '08:15', dueDate: null, sex: 'male' });
    expect(logToBody(note).payload).toEqual({ type: 'note', text: 'First smile' });
  });

  it('keep this device photo and import ref when applying a pulled version', () => {
    const pulled = bodyToChild(child.id, { ...childToBody(child), name: 'Samuel' }, { updatedAt: 2000 }, child);
    expect(pulled).toMatchObject({ name: 'Samuel', photoUri: child.photoUri, importRef: child.importRef, syncStatus: 'synced', updatedAt: 2000 });

    const log = bodyToLog(note.id, { ...logToBody(note), payload: { type: 'note', text: 'First big smile' } }, { updatedAt: 2000 }, note);
    expect(log.payload).toEqual({ type: 'note', text: 'First big smile', photoUri: 'file:///data/photos/2.jpg' });
  });

  it('builds new rows for records this device has never seen', () => {
    expect(bodyToChild(child.id, childToBody(child), { updatedAt: 2000 }, undefined)).toMatchObject({ photoUri: null, importRef: null });
    expect(bodyToLog(note.id, logToBody(note), { updatedAt: 2000 }, undefined).payload).toEqual({ type: 'note', text: 'First smile' });
  });
});
