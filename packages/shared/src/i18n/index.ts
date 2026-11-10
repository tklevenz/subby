import { en } from './en';

/**
 * The app's languages. English is the source and the fallback; every other catalog must have the same keys and
 * placeholders (`Translation`, checked by the type and by `i18n.test.ts`).
 */
export const LOCALES = ['en', 'de', 'es', 'fr', 'nl', 'it', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];

/** Each language's name in itself, for the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  nl: 'Nederlands',
  it: 'Italiano',
  'pt-BR': 'Português (Brasil)',
};

/** A plural message: `one` for a single thing (and 0 in French and Portuguese), `other` for the rest. */
export type Plural = { one: string; other: string };
export type En = typeof en;
export type MessageKey = keyof En;
/** A catalog for another language: every English key, plurals where English has them. */
export type Translation = { [K in MessageKey]: En[K] extends string ? string : Plural };

type Catalog = Record<string, string | Plural>;
const catalogs: Partial<Record<Locale, Catalog>> = { en };

/** Adds a language's catalog (the app registers them at startup; shared only bundles English). */
export function registerCatalog(locale: Locale, catalog: Translation) {
  catalogs[locale] = catalog;
}

let current: Locale = 'en';

export const getLocale = () => current;
export function setLocale(locale: Locale) {
  current = locale;
}

/**
 * The best of our languages for the phone's preferred ones (BCP 47 tags, most preferred first): an exact match,
 * then the language alone ("pt-PT" → "pt-BR", "de-AT" → "de"); English when none fits.
 */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const exact = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const lang = tag.split(/[-_]/)[0].toLowerCase();
    const byLang = LOCALES.find((l) => l.split('-')[0] === lang);
    if (byLang) return byLang;
  }
  return 'en';
}

/** CLDR plural category for our languages: French and Portuguese count 0 and 1 as one, the others only 1. */
export function pluralCategory(locale: Locale, n: number): keyof Plural {
  // CLDR: fr and pt "i = 0,1" (the integer part, so 1.5 is one too); en, de, es, nl, it "i = 1 and v = 0".
  if (locale === 'fr' || locale === 'pt-BR') return Math.trunc(Math.abs(n)) <= 1 ? 'one' : 'other';
  return n === 1 ? 'one' : 'other';
}

export type Params = Record<string, string | number>;

/** Numbers in the current language's grouping and decimal mark ("10,500", "2.5"; German "10.500", "2,5"). */
export const formatNumber = (n: number, options?: Intl.NumberFormatOptions) => n.toLocaleString(current, options);

/** A date in the current language ("Sat, Oct 24", "Sa., 24. Okt."). */
export const formatDate = (ms: number, options: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString(current, options);

/** A time of day in the current language, on the user's 12- or 24-hour clock. */
export const formatClock = (ms: number, clock: '12h' | '24h') =>
  new Date(ms).toLocaleTimeString(current, { hour: '2-digit', minute: '2-digit', hour12: clock === '12h' });

/**
 * The message for `key` in the current language (else English), with `{name}` placeholders filled in. Plural
 * messages pick their form by `params.count`. Numbers are formatted for the language ("2,5" in German), so pass a
 * year or an id as a string.
 */
export function t(key: MessageKey, params?: Params): string {
  const msg = catalogs[current]?.[key] ?? (en as Catalog)[key];
  const text = typeof msg === 'string' ? msg : msg[pluralCategory(current, Number(params?.count ?? 0))];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    if (v === undefined) return whole;
    return typeof v === 'number' ? formatNumber(v) : v;
  });
}

/** The `{placeholders}` a message uses (both plural forms), for the catalog test. */
export function placeholders(msg: string | Plural): string[] {
  const texts = typeof msg === 'string' ? [msg] : [msg.one, msg.other];
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
}

export { en };
