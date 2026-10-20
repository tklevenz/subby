import { create } from 'zustand';
import type { LogPayload, LogType } from '@kindred-log/shared';

export type SheetRequest =
  | { kind: 'feed'; tab?: 'breast' | 'bottle' | 'solids' }
  | { kind: 'add' }
  | { kind: 'diaper' }
  | { kind: 'log'; type: LogType; payload?: Partial<LogPayload> };

/** Which logging sheet is open on the Home screen (opened from the dock, header, timers…). */
export const useSheetStore = create<{
  sheet: SheetRequest | null;
  open: (sheet: SheetRequest) => void;
  close: () => void;
}>((set) => ({
  sheet: null,
  open: (sheet) => set({ sheet }),
  close: () => set({ sheet: null }),
}));
