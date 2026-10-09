import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import styles from "./Button.module.css";

export type ButtonVariant = "default" | "primary" | "photo";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly small?: boolean;
}

/** Prototype `.btn` (`.primary`, `.small`, `:disabled`). Defaults to `type="button"`; hidden when printing. */
export function Button({ variant = "default", small = false, type = "button", className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        styles.btn,
        variant === "primary" && styles.primary,
        variant === "photo" && styles.photo,
        small && styles.small,
        className,
      )}
    />
  );
}
