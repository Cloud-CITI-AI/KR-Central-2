import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Tag.module.css";

export type TagVariant = "fee" | "krpay" | "claim" | "trig";

export interface TagProps {
  /** fee = client payment, krpay = KR payment, claim = "ITEM n PAYMENT REQUIRED", trig = trigger note. */
  readonly variant?: TagVariant;
  readonly children: ReactNode;
}

/** Prototype `.tag`: small pill. The text always carries the meaning; colour is never the only signal (§12). */
export function Tag({ variant, children }: TagProps) {
  return <span className={cx(styles.tag, variant && styles[variant])}>{children}</span>;
}
