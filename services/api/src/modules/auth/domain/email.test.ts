import { describe, expect, it } from "vitest";
import { emailDomain, selectEmail } from "./email.js";

describe("selectEmail", () => {
  it("members use the email claim, lower-cased and trimmed", () => {
    expect(selectEmail({ isGuest: false, email: " Mia@Staff.TEST ", preferredUsername: "upn@staff.test" })).toBe(
      "mia@staff.test",
    );
  });

  it("members fall back to preferred_username (the UPN) when there is no email claim", () => {
    expect(selectEmail({ isGuest: false, preferredUsername: "Mia@Staff.test" })).toBe("mia@staff.test");
    expect(selectEmail({ isGuest: false, email: "not an address", preferredUsername: "mia@staff.test" })).toBe(
      "mia@staff.test",
    );
  });

  it("guests use the email claim only, never the guest object's UPN", () => {
    expect(
      selectEmail({ isGuest: true, email: "g@client.test", preferredUsername: "g_client.test#EXT#@kr.test" }),
    ).toBe("g@client.test");
    expect(selectEmail({ isGuest: true, preferredUsername: "g_client.test#EXT#@kr.test" })).toBeNull();
    expect(selectEmail({ isGuest: true, email: "bad", preferredUsername: "g@client.test" })).toBeNull();
  });

  it.each(["", "no-at-sign", "a@@b.test", "a b@c.test", `${"a".repeat(250)}@b.test`])("drops %j", (bad) => {
    expect(selectEmail({ isGuest: false, email: bad })).toBeNull();
  });
});

describe("emailDomain", () => {
  it("is everything after the @", () => {
    expect(emailDomain("mia@staff.test")).toBe("staff.test");
  });
});
