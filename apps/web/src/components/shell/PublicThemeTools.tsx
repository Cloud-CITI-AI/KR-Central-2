"use client";
import { useSyncExternalStore } from "react";
import { readTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { Icons } from "./icons";
import shell from "./Shell.module.css";
import styles from "./PublicShell.module.css";

const THEMES: readonly { readonly value: Theme; readonly label: string; readonly Icon: (typeof Icons)["sun"] }[] = [
  { value: "system", label: "System theme", Icon: Icons.monitor },
  { value: "light", label: "Light theme", Icon: Icons.sun },
  { value: "dark", label: "Dark theme", Icon: Icons.moon },
];

/** System / Light / Dark as icon buttons (§12); the same control the sidebar's user block uses. */
export function PublicThemeTools() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, (): Theme => "system");
  return (
    <div className={styles.themeTools} role="group" aria-label="Theme">
      {THEMES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className={shell.tool}
          aria-label={label}
          title={label}
          aria-pressed={theme === value}
          onClick={() => {
            setTheme(value);
          }}
        >
          <Icon width={16} height={16} />
        </button>
      ))}
    </div>
  );
}
