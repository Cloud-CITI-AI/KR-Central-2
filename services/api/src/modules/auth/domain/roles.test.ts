import { describe, expect, it } from "vitest";
import { assignRole, isFirstAdminEligible } from "./roles.js";

const staffDomains = ["krsurveys.com.au", " Example-Staff.test "];

describe("assignRole", () => {
  it("makes members on a staff domain staff, whatever the case of the list or address", () => {
    expect(assignRole({ isGuest: false, email: "a@krsurveys.com.au", staffDomains })).toBe("staff");
    expect(assignRole({ isGuest: false, email: "a@example-staff.test", staffDomains })).toBe("staff");
  });

  it("makes every other member external, including look-alike and sub-domains", () => {
    for (const email of [
      "a@gmail.test",
      "a@evilkrsurveys.com.au",
      "a@mail.krsurveys.com.au",
      "a@krsurveys.com.au.evil.test",
    ])
      expect(assignRole({ isGuest: false, email, staffDomains })).toBe("external");
    expect(assignRole({ isGuest: false, email: null, staffDomains })).toBe("external");
  });

  it("never gives a guest a staff role, even with a staff-domain address", () => {
    expect(assignRole({ isGuest: true, email: "a@krsurveys.com.au", staffDomains })).toBe("external");
  });
});

describe("isFirstAdminEligible", () => {
  it("accepts only non-guest staff", () => {
    expect(isFirstAdminEligible({ isGuest: false, role: "staff" })).toBe(true);
    expect(isFirstAdminEligible({ isGuest: true, role: "staff" })).toBe(false);
    for (const role of ["external", "kr_admin", "admin"] as const)
      expect(isFirstAdminEligible({ isGuest: false, role })).toBe(false);
  });
});
