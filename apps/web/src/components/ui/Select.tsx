import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";
import styles from "./Control.module.css";

/** Native select (prototype `.jobbar select`, agency and responsibility pickers). */
export function Select({ className, ...rest }: ComponentProps<"select">) {
  return <select {...rest} className={cx(styles.control, styles.select, className)} />;
}
