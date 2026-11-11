import { create } from 'zustand';
import type { LogPayload, LogType } from '@subby/shared';

export type SheetRequest =
  | { kind: 'feed'; tab?: 'breast' | 'bottle' | 'solids' }
  /** `at`: logging on another day (History's +): the grid opens plain log sheets starting then. */
  | { kind: 'add'; at?: number }
  | { kind: 'diaper' }
  | { kind: 'log'; type: LogType; payload?: Partial<LogPayload>; at?: number };

/** Which logging sheet is open on the tabs (opened from Home's tiles, the + in the header, timers…). */
export const useSheetStore = create<{
  sheet: SheetRequest | null;
  open: (sheet: SheetRequest) => void;
  close: () => void;
}>((set) => ({
  sheet: null,
  open: (sheet) => set({ sheet }),
  close: () => set({ sheet: null }),
}));
