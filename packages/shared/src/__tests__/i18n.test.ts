import { afterEach, describe, expect, it } from 'vitest';
import { en, getLocale, pickLocale, placeholders, pluralCategory, registerCatalog, setLocale, t, type Translation } from '../i18n';
import { TRANSLATIONS } from '../i18n/catalogs';
import { REVIEW_KEYS } from '../i18n/review';
import { formatAge, formatAgeLong, formatDuration, formatRelative } from '../domain/time';
import { formatDose, formatWeight } from '../domain/units';

afterEach(() => setLocale('en'));

describe('i18n', () => {
  it('picks our language for the phone', () => {
    expect(pickLocale(['de-AT', 'en-US'])).toBe('de');
    expect(pickLocale(['pt-PT'])).toBe('pt-BR');
    expect(pickLocale(['pt-BR'])).toBe('pt-BR');
    expect(pickLocale(['ja-JP', 'fr-CA'])).toBe('fr');
    expect(pickLocale(['ja-JP'])).toBe('en');
    expect(pickLocale([])).toBe('en');
  });

  it('knows the plural forms', () => {
    expect(pluralCategory('en', 1)).toBe('one');
    expect(pluralCategory('en', 0)).toBe('other');
    expect(pluralCategory('de', 1.5)).toBe('other');
    expect(pluralCategory('fr', 0)).toBe('one');
    expect(pluralCategory('fr', 1.5)).toBe('one');
    expect(pluralCategory('pt-BR', 2)).toBe('other');
  });

  it('fills placeholders and picks plurals', () => {
    expect(t('age.days', { count: 1 })).toBe('1 day');
    expect(t('age.days', { count: 3 })).toBe('3 days');
    expect(t('time.ago', { span: '5m' })).toBe('5m ago');
    expect(formatAgeLong('2026-01-01', new Date(2026, 4, 3).getTime())).toBe('4 months, 2 days');
  });

  it('formats numbers for the language', () => {
    setLocale('de');
    expect(formatDose(2.5, 'ml')).toBe('2,5 ml');
    expect(formatWeight(3250, 'metric')).toBe('3,25 kg');
  });

  it('falls back to English for a key a catalog lacks', () => {
    registerCatalog('nl', { ...(en as unknown as Translation), 'day.today': 'Vandaag' });
    setLocale('nl');
    expect(getLocale()).toBe('nl');
    expect(t('day.today')).toBe('Vandaag');
    expect(t('day.yesterday')).toBe('Yesterday');
  });

  it('keeps English output as before', () => {
    expect(formatDuration(3_725_000)).toBe('1h 2m');
    expect(formatRelative(30_000)).toBe('Just now');
    expect(formatAge('2026-01-01', new Date(2026, 0, 2).getTime())).toBe('1 day');
    expect(formatDose(1, 'drops')).toBe('1 drop');
    expect(formatDose(2, 'tablets')).toBe('2 tablets');
  });

  it('has both forms in every English plural', () => {
    for (const [key, msg] of Object.entries(en)) {
      if (typeof msg === 'string') continue;
      expect(msg.one, key).toBeTruthy();
      expect(msg.other, key).toBeTruthy();
    }
  });
});

describe('catalogs', () => {
  const keys = Object.keys(en).sort();

  it('lists only review keys that exist', () => {
    const stale = REVIEW_KEYS.filter((k) => (k.endsWith('.') ? !keys.some((key) => key.startsWith(k)) : !keys.includes(k)));
    expect(stale).toEqual([]);
  });

  for (const [locale, catalog] of Object.entries(TRANSLATIONS)) {
    describe(locale, () => {
      it('has exactly the English keys', () => {
        expect(Object.keys(catalog).sort()).toEqual(keys);
      });

      it('keeps every placeholder and plural', () => {
        const wrong = keys.filter((k) => {
          const mine = (catalog as Record<string, string | { one: string; other: string }>)[k];
          const theirs = (en as Record<string, string | { one: string; other: string }>)[k];
          if (mine === undefined || typeof mine !== typeof theirs) return true;
          // A plural form may leave out {count} ("a day"); the placeholders of both forms together must match.
          return placeholders(mine).join() !== placeholders(theirs).join();
        });
        expect(wrong).toEqual([]);
      });

      it('translates something (no catalog that is just English)', () => {
        const same = keys.filter((k) => JSON.stringify((catalog as Record<string, unknown>)[k]) === JSON.stringify((en as Record<string, unknown>)[k]));
        expect(same.length).toBeLessThan(keys.length / 3);
      });
    });
  }
});
