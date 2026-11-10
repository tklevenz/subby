import { getLocales } from 'expo-localization';
import { create } from 'zustand';
import { getLocale, pickLocale, registerCatalog, setLocale, type Locale } from '@subby/shared/i18n';
import { TRANSLATIONS } from '@subby/shared/i18n/catalogs';

for (const [locale, catalog] of Object.entries(TRANSLATIONS)) registerCatalog(locale as Locale, catalog);

/** The language in use; the root layout re-renders the app under it when it changes. */
export const useLocale = create<{ locale: Locale }>(() => ({ locale: getLocale() }));

/** The language setting: the phone's (default), or one picked in Settings. */
export type LanguageChoice = 'system' | Locale;

/** The phone's language among ours (per-app language on Android 13+ and iOS included), else English. */
export const systemLocale = (): Locale => pickLocale(getLocales().map((l) => l.languageTag));

export const resolveLocale = (choice: LanguageChoice): Locale => (choice === 'system' ? systemLocale() : choice);

/** Makes `choice` the language of every `t()` from now on (screens re-render through `useLocale`). */
export function applyLanguage(choice: LanguageChoice): Locale {
  const locale = resolveLocale(choice);
  setLocale(locale);
  if (useLocale.getState().locale !== locale) useLocale.setState({ locale });
  return locale;
}
