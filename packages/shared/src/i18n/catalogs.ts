import type { Locale, Translation } from './index';
import { de } from './de';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { nl } from './nl';
import { ptBR } from './ptBR';

/**
 * Every language besides English (the source, in en.ts). A catalog must have every English key, with the same
 * `{placeholders}` and plurals where English has them (the `Translation` type and i18n.test.ts check both). The app
 * registers these at startup. Every language must be here (a missing key still falls back to English at runtime).
 */
export const TRANSLATIONS: Record<Exclude<Locale, 'en'>, Translation> = { de, es, fr, it, nl, 'pt-BR': ptBR };
