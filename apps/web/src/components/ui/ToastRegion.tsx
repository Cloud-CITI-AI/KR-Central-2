"use client";
import { useToast } from "@/lib/toast/ToastProvider";
import styles from "./ToastRegion.module.css";

/** Always-mounted polite live region for toasts (so additions are announced), pinned bottom-left. */
export function ToastRegion() {
  const { toasts } = useToast();
  return (
    <div className={styles.region} role="status" aria-live="polite">
      {toasts.map((t) => (
        <p key={t.id} className={styles.toast}>
          {t.text}
        </p>
      ))}
    </div>
  );
}
