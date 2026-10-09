"use client";
import { useSession } from "@/lib/session";
import { ACCESS_MESSAGES } from "./messages";
import styles from "./AccessManager.module.css";

/**
 * ACCESS MANAGER (§6, staff only: `access.manage`): grant clients and architects a job. Hidden from externals and from
 * the printed page ("Save as PDF").
 */
export function AccessManager() {
  const { capabilities, features } = useSession();
  if (!capabilities.includes("access.manage")) return null;
  return (
    <section className={styles.box} aria-labelledby="access-title">
      <div className={styles.head}>
        <h2 id="access-title" className={styles.title}>
          {ACCESS_MESSAGES.title}
        </h2>
        <p className={styles.text}>
          {ACCESS_MESSAGES.description}{" "}
          {features.guestInvites ? ACCESS_MESSAGES.invitationOn : ACCESS_MESSAGES.invitationOff}
        </p>
      </div>
    </section>
  );
}
