import { useChildStore } from './useChildStore';
import { useSettingsStore } from './useSettingsStore';

/** The selected child, falling back to the first one if the stored id is missing. */
export function useActiveChild() {
  const children = useChildStore((s) => s.children);
  const activeId = useSettingsStore((s) => s.activeChildId);
  return children.find((c) => c.id === activeId) ?? children[0];
}
