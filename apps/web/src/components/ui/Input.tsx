import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";
import styles from "./Control.module.css";

/** Text input (prototype `form.newjob input`). Label it through `<Field>` or `aria-label`. */
export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input {...rest} className={cx(styles.control, className)} />;
}
