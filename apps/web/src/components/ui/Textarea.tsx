import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";
import styles from "./Control.module.css";

/** Multi-line input for comments and notes. */
export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea {...rest} className={cx(styles.control, styles.textarea, className)} />;
}
