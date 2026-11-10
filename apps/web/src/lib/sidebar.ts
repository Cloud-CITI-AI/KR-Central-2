/**
 * Sidebar preference (KR Central shell): expanded by default, folded to the 64px icon rail when the person asks, kept
 * in localStorage `kr-sidebar` on the same terms as the theme (storage may be blocked: then it lives in memory).
 */
export const SIDEBAR_STORAGE_KEY = "kr-sidebar";

let memory: boolean | undefined;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

/** True when the sidebar is folded. */
export function readSidebarCollapsed(): boolean {
  if (memory !== undefined) return memory;
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  memory = collapsed;
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_STORAGE_KEY, "collapsed");
    else localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    // storage blocked: the choice still applies to this tab
  }
  emit();
}

export function subscribeSidebar(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget the in-memory choice. */
export function resetSidebarForTests(): void {
  memory = undefined;
}
