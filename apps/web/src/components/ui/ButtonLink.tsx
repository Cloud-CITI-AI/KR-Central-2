import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Button.module.css";
import type { ButtonVariant } from "./Button";

export interface ButtonLinkProps {
  readonly href: string;
  readonly children: ReactNode;
  readonly variant?: ButtonVariant;
  readonly small?: boolean;
}

/**
 * A navigation link that looks like a Button (e.g. "Sign in with Microsoft", "Try again"). `/api/*` targets are
 * plain anchors: they are route handlers (redirects to the identity provider), not pages for client-side navigation.
 */
export function ButtonLink({ href, children, variant = "default", small = false }: ButtonLinkProps) {
  const className = cx(
    styles.btn,
    variant === "primary" && styles.primary,
    variant === "photo" && styles.photo,
    small && styles.small,
  );
  return href.startsWith("/api/") ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
