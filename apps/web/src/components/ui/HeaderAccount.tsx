"use client";
import { hasCapability } from "@kr/contracts/capabilities";
import { useSession } from "@/lib/session";
import { ButtonLink } from "./ButtonLink";
import { SignOutButton } from "./SignOutButton";
import { ThemeControl } from "./ThemeControl";
import styles from "./AppHeader.module.css";

/**
 * The signed-in controls in the hero bar (PRODUCT_SPEC §4): the user's name, the theme control, an Admin link for
 * `users.manage` (→ users) or `audit.read` (→ audit, kr_admin), and Sign out. Follows the live session, so a role change
 * shows without a reload.
 */
export function HeaderAccount() {
  const me = useSession();
  const adminHref = hasCapability(me.capabilities, "users.manage")
    ? "/admin/users"
    : hasCapability(me.capabilities, "audit.read")
      ? "/admin/audit"
      : undefined;
  return (
    <>
      <span className={styles.user}>{me.user.displayName}</span>
      <ThemeControl />
      {adminHref && (
        <ButtonLink href={adminHref} variant="photo" small>
          Admin
        </ButtonLink>
      )}
      <SignOutButton />
    </>
  );
}
