import type { UnitSystem } from '@subby/shared';

/** What expo-localization reports, reduced to what we read (kept as plain values so it's testable). */
export type PhoneRegion = {
  /** `getLocales()[0].measurementSystem`. */
  measurementSystem?: 'metric' | 'us' | 'uk' | null;
  /** `getCalendars()[0].uses24hourClock`. */
  uses24hourClock?: boolean | null;
};

/**
 * Units and clock for a fresh install, from the phone's region: imperial only where the phone says US
 * (UK baby scales and the red book use kg), and the phone's clock. Unknown falls back to metric, 24-hour.
 */
export function regionalDefaults(phone: PhoneRegion): { units: UnitSystem; clock: '12h' | '24h' } {
  return {
    units: phone.measurementSystem === 'us' ? 'imperial' : 'metric',
    clock: phone.uses24hourClock === false ? '12h' : '24h',
  };
}
