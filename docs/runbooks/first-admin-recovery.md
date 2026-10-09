# First admin and admin recovery

Who becomes admin, what to do when there is none you can use, and the one command that fixes it. Source: PRODUCT_SPEC
3.3, ADR-0003, `services/api/src/cli/promote-admin.ts`. Admin pages need multi-factor evidence (`REQUIRE_MFA_FOR_ADMIN`),
but `promote-admin` does not: it works on the database directly, as the recovery path.

## How the first admin is chosen

The first **eligible** user to finish sign-in becomes `admin`: a tenant member (not a guest) whose email domain is in
`KR_STAFF_EMAIL_DOMAINS`. The singleton row `system_bootstrap` makes this race-safe and happens once ever. Guests can
never become admin. Before production go-live arrange that the intended administrator signs in first, from the
production address, before anyone else is told the site exists.

Check the state (read-only session, [README](README.md#a-read-only-sql-session)):

```sql
SELECT first_admin_user_id, created_at FROM tracker.system_bootstrap;       -- no row: nobody has been chosen yet
SELECT id, role, status, is_guest, last_sign_in_at FROM tracker.users WHERE role IN ('admin', 'kr_admin') ORDER BY role, last_sign_in_at;
```

## The wrong person became admin

No operator action is needed. That admin promotes the right person in `/admin/users`; the right admin then demotes
the wrong one (nobody can change their own role). The API refuses to demote or disable the last active admin, so you
cannot lock yourself out this way.

## There is no admin who can sign in

The admin left, was disabled, or lost their Entra access, and nobody else is `admin` (`kr_admin` cannot manage users).

1. The person to promote must be a KR staff member who has **already signed in once** (so a user row exists), a tenant
   member rather than a guest, active, and the only active member with that email. If they have not signed in, ask them to
   sign in first; they become `staff` and can then be promoted.
2. Get a shell in the running `api` service of the environment (Railway one-off shell; it holds `DATABASE_URL` and the
   rest of the API configuration). Confirm before running: this is the intended environment, KR has approved
   promoting `<email>` in the operations log, and a second person has read the address back.
3. In `/app` of the container run:

   ```sh
   node dist/cli/promote-admin.js <email>
   ```

4. Read the answer and the exit code:

   | Exit | Message                                                                              | Meaning                                            |
   | ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
   | 0    | "Promoted the user to admin; their sessions were revoked."                           | Done                                               |
   | 0    | "That user is already an admin; nothing changed."                                    | Nothing to do                                      |
   | 1    | "No user has signed in with that email yet; ask them to sign in first."              | See step 1                                         |
   | 1    | "Refused: that account is a guest (B2B) account; guests are never admins."           | Choose a staff member                              |
   | 1    | "Refused: that user is disabled." / "...more than one active member has that email." | Enable the user, or resolve the duplicate in Entra |
   | 2    | "Usage: promote-admin <email>"                                                       | Give exactly one address                           |

   The command prints the user id, never the email, a token or a password. It also claims the `system_bootstrap` row, so
   no later first sign-in can become admin by itself.

5. The user signs in again (their sessions were revoked) and opens `/admin/users`. If that answers 403 "Multi-factor
   sign-in required", sign-in is fine and the problem is MFA evidence: Conditional Access and go-live checks G1 and G2 in
   [deploy/railway.md](../deploy/railway.md); `promote-admin` stays available meanwhile.
6. Verify and record: the audit trail (`/admin/audit`) shows a `user.role_changed` event with request id
   `cli:promote-admin` and no actor; write it in the operations log.

Never set a role by editing `tracker.users` yourself: the command also revokes sessions, claims the bootstrap row and
writes the audit event in one transaction.

## If nobody can sign in at all

That is not an admin problem. See [auth-failure-spike](auth-failure-spike.md) (expired Entra secret, redirect URI) first.
