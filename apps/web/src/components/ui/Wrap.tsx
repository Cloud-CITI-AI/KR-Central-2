import type { ElementType, ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Wrap.module.css";

export interface WrapProps {
  readonly as?: ElementType;
  readonly className?: string | undefined;
  /** Adds the top and bottom spacing the prototype's own pages (job bar, footer) supply. */
  readonly spaced?: boolean;
  readonly children: ReactNode;
}

/** Prototype `.wrap`: 1180 px page column with 16 px side gutters. */
export function Wrap({ as: Tag = "div", className, spaced = false, children }: WrapProps) {
  return <Tag className={cx(styles.wrap, spaced && styles.spaced, className)}>{children}</Tag>;
}
