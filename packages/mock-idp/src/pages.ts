/** Tiny HTML pages of the mock IdP (user picker, auto-submitted logout). Every dynamic value is escaped. */
import type { MockUser } from "./index.js";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;

/** Shown when the authorize request carries no `login_hint`: pick who to sign in as, or cancel. */
export function userPickerPage(base: string, users: readonly MockUser[]): string {
  const items = users
    .map(
      (u) =>
        `<li><a href="${escapeHtml(`${base}/pick?oid=${encodeURIComponent(u.oid)}`)}">${escapeHtml(u.name)} (${escapeHtml(u.email ?? u.preferredUsername)})</a></li>`,
    )
    .join("");
  return page(
    "Mock Entra sign-in",
    `<ul>${items}</ul><p><a href="${escapeHtml(`${base}/cancel`)}">Cancel sign-in</a></p>`,
  );
}

/** The end-session form, submitted at once so a browser lands on the post-logout redirect without a click. */
export function logoutPage(form: string): string {
  return page("Signing out", `${form}<script>document.forms[0].submit()</script>`);
}

export function signedOutPage(): string {
  return page("Signed out", "<p>You have been signed out of the mock identity provider.</p>");
}
