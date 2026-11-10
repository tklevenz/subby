import type { Locale, Translation } from './index';
import { de } from './de';
import { es } from './es';
import { fr } from './fr';

/**
 * Every language besides English (the source, in en.ts). A catalog must have every English key, with the same
 * `{placeholders}` and plurals where English has them (the `Translation` type and i18n.test.ts check both). The app
 * registers these at startup; until a language is here, it shows English.
 */
export const TRANSLATIONS: Partial<Record<Exclude<Locale, 'en'>, Translation>> = { de, es, fr };
