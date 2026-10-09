/**
 * Theme preference (§12): "system" follows the OS (no attribute), "light"/"dark" set `data-theme` on <html> and are
 * kept in localStorage `kr-theme`. Storage can be unavailable (private window, blocked site data): every access is in
 * try/catch and the choice then lives in memory for the tab.
 */
export type Theme = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "kr-theme";

/** Inline script (given a CSP nonce) that applies the stored theme before first paint. No quote or markup characters, so React emits it unescaped. */
export const THEME_BOOTSTRAP_SCRIPT =
  "try{var t=localStorage.getItem(`kr-theme`);if(t===`light`||t===`dark`)document.documentElement.setAttribute(`data-theme`,t)}catch(e){}";

let memory: Theme | undefined;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const parse = (value: string | null): Theme => (value === "light" || value === "dark" ? value : "system");

export function readTheme(): Theme {
  if (memory) return memory;
  try {
    return parse(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system"; // storage blocked: nothing remembered
  }
}

export function setTheme(theme: Theme): void {
  memory = theme;
  try {
    if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage blocked: the choice still applies to this tab
  }
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  emit();
}

/** For useSyncExternalStore: re-read when this tab or another tab changes the preference. */
export function subscribeTheme(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      memory = undefined;
      listener();
    }
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
