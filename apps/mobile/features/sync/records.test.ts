import { describe, expect, it } from 'vitest';
import type { Child, LogEntry } from '@kindred-log/shared';
import { blobIdsOf, bodyToChild, bodyToLog, childToBody, isValidBody, logToBody, needsPhotoUpload } from './records';

const blobA = { id: '0190a000-0000-7000-8000-0000000000aa', key: 'a-key' };
const blobB = { id: '0190a000-0000-7000-8000-0000000000bb', key: 'b-key' };

const child: Child = {
  id: '0190a000-0000-7000-8000-000000000000',
  name: 'Sam',
  birthDate: '2024-07-27',
  birthTime: '08:15',
  dueDate: null,
  sex: 'male',
  photoUri: 'file:///data/photos/1.jpg',
  photoBlob: blobA,
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
  payload: { type: 'note', text: 'First smile', photoUri: 'file:///data/photos/2.jpg', photoBlob: blobB },
  updatedAt: 1000,
  isDeleted: false,
  syncStatus: 'pending',
  importRef: null,
};

describe('sync record bodies', () => {
  it('leave device-local fields out', () => {
    expect(childToBody(child)).toEqual({ name: 'Sam', birthDate: '2024-07-27', birthTime: '08:15', dueDate: null, sex: 'male', photoBlob: blobA });
    expect(logToBody(note).payload).toEqual({ type: 'note', text: 'First smile', photoBlob: blobB });
  });

  it('keep this device photo and import ref when applying a pulled version', () => {
    const pulled = bodyToChild(child.id, { ...childToBody(child), name: 'Samuel' }, { updatedAt: 2000 }, child);
    expect(pulled).toMatchObject({ name: 'Samuel', photoUri: child.photoUri, importRef: child.importRef, syncStatus: 'synced', updatedAt: 2000 });

    const log = bodyToLog(note.id, { ...logToBody(note), payload: { type: 'note', text: 'First big smile', photoBlob: blobB } }, { updatedAt: 2000 }, note);
    expect(log.payload).toEqual({ type: 'note', text: 'First big smile', photoUri: 'file:///data/photos/2.jpg', photoBlob: blobB });
  });

  it('drop this device photo copy when the record points at another photo, or none', () => {
    const other = { id: '0190a000-0000-7000-8000-0000000000cc', key: 'c-key' };
    expect(bodyToChild(child.id, { ...childToBody(child), photoBlob: other }, { updatedAt: 2000 }, child)).toMatchObject({ photoUri: null, photoBlob: other });
    expect(bodyToChild(child.id, { ...childToBody(child), photoBlob: null }, { updatedAt: 2000 }, child)).toMatchObject({ photoUri: null, photoBlob: null });
    const removed = bodyToLog(note.id, { ...logToBody(note), payload: { type: 'note', text: 'First smile' } }, { updatedAt: 2000 }, note);
    expect(removed.payload).toEqual({ type: 'note', text: 'First smile' });
  });

  it('know which photos still need uploading and which blobs a record uses', () => {
    expect(needsPhotoUpload(child)).toBe(false);
    expect(needsPhotoUpload({ ...child, photoBlob: null })).toBe(true);
    expect(needsPhotoUpload({ ...child, photoUri: null })).toBe(false); // from another phone, not downloaded yet
    expect(needsPhotoUpload({ ...note, payload: { type: 'note', text: 'x', photoUri: 'file:///p.jpg' } })).toBe(true);
    expect(blobIdsOf(child)).toEqual([blobA.id]);
    expect(blobIdsOf(note)).toEqual([blobB.id]);
    expect(blobIdsOf({ ...child, photoBlob: null })).toEqual([]);
  });

  it('builds new rows for records this device has never seen', () => {
    expect(bodyToChild(child.id, childToBody(child), { updatedAt: 2000 }, undefined)).toMatchObject({ photoUri: null, photoBlob: blobA, importRef: null });
    expect(bodyToLog(note.id, logToBody(note), { updatedAt: 2000 }, undefined).payload).toEqual({ type: 'note', text: 'First smile', photoBlob: blobB });
  });
});

describe('isValidBody', () => {
  it('accepts what this app writes', () => {
    expect(isValidBody('child', childToBody(child))).toBe(true);
    expect(isValidBody('log', logToBody(note))).toBe(true);
    expect(isValidBody('device', { name: 'Pixel 10' })).toBe(true);
  });

  it('rejects malformed bodies, including photo ids that aren\'t UUIDs', () => {
    expect(isValidBody('child', { ...childToBody(child), birthDate: 'soon' })).toBe(false);
    expect(isValidBody('child', { ...childToBody(child), photoBlob: { id: '../../SQLite/kindred.db', key: 'x' } })).toBe(false);
    expect(isValidBody('log', { ...logToBody(note), logType: 'sleep' })).toBe(false);
    expect(isValidBody('log', { ...logToBody(note), payload: { ...note.payload, photoBlob: { id: 'nope', key: 'x' } } })).toBe(false);
    expect(isValidBody('log', { ...logToBody(note), startedAt: 'yesterday' })).toBe(false);
    expect(isValidBody('device', { name: '' })).toBe(false);
    expect(isValidBody('log', null)).toBe(false);
  });

  it('checks payload field types, not values', () => {
    const log = (payload: object) => ({ ...logToBody(note), logType: (payload as { type: string }).type, payload });
    // What a screen would crash on: a name that isn't a string, foods that aren't a list, a required field missing.
    expect(isValidBody('log', log({ type: 'medication', name: 123 }))).toBe(false);
    expect(isValidBody('log', log({ type: 'medication' }))).toBe(false);
    expect(isValidBody('log', log({ type: 'feed', method: 'solids', foods: 'apple' }))).toBe(false);
    expect(isValidBody('log', log({ type: 'note', text: 'x', tags: [1] }))).toBe(false);
    // Unusual values still sync: empty text, an unknown enum value or field, a null, a negative amount.
    expect(isValidBody('log', log({ type: 'note', text: '' }))).toBe(true);
    expect(isValidBody('log', log({ type: 'feed', method: 'spoon', amountMl: -5, newField: { a: 1 } }))).toBe(true);
    expect(isValidBody('log', log({ type: 'diaper', condition: 'wet', color: null }))).toBe(true);
  });
});
