import Link from "next/link";
import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";
import styles from "./Button.module.css";
import type { ButtonVariant } from "./Button";

export interface ButtonLinkProps extends Omit<ComponentProps<typeof Link>, "className"> {
  readonly variant?: ButtonVariant;
  readonly small?: boolean;
}

/** A navigation link that looks like a Button (e.g. "Sign in with Microsoft", "Try again"). */
export function ButtonLink({ variant = "default", small = false, ...rest }: ButtonLinkProps) {
  return (
    <Link
      {...rest}
      className={cx(
        styles.btn,
        variant === "primary" && styles.primary,
        variant === "photo" && styles.photo,
        small && styles.small,
      )}
    />
  );
}
