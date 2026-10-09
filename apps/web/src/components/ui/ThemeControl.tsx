"use client";
import { useSyncExternalStore } from "react";
import { readTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { Button } from "./Button";

const OPTIONS: readonly { readonly value: Theme; readonly label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** System / Light / Dark switch for the hero bar (§4, §12). `aria-pressed` marks the current choice. */
export function ThemeControl() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, (): Theme => "system");
  return (
    <div role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label }) => (
        <Button
          key={value}
          variant="photo"
          small
          aria-pressed={theme === value}
          onClick={() => {
            setTheme(value);
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
