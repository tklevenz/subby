import { useChildStore } from './useChildStore';
import { useSettingsStore } from './useSettingsStore';

/** The selected child, falling back to the first one if the stored id is missing. */
export const activeChildOf = <C extends { id: string }>(children: C[], activeId: string | null): C | undefined =>
  children.find((c) => c.id === activeId) ?? children[0];

export function useActiveChild() {
  const children = useChildStore((s) => s.children);
  const activeId = useSettingsStore((s) => s.activeChildId);
  return activeChildOf(children, activeId);
}
