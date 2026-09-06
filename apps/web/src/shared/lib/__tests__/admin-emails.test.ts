import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_ADMIN_EMAILS,
  getAdminEmailWhitelist,
  isWhitelistedAdminEmail,
  normalizeAdminEmail,
  resolveEffectiveAdminRole,
} from "../../../../../../apps/api/src/server/admin-emails";

describe("admin email whitelist", () => {
  const original = process.env.ADMIN_EMAILS;

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = original;
  });

  it("always includes the built-in owner email", () => {
    delete process.env.ADMIN_EMAILS;
    const whitelist = getAdminEmailWhitelist();
    for (const email of DEFAULT_ADMIN_EMAILS) {
      expect(whitelist.has(email)).toBe(true);
    }
    expect(isWhitelistedAdminEmail("blue45f@gmail.com")).toBe(true);
    expect(isWhitelistedAdminEmail("  Blue45F@gmail.com ")).toBe(true);
  });

  it("merges ADMIN_EMAILS env entries", () => {
    process.env.ADMIN_EMAILS = "ops@example.com, Second@Example.COM ";
    expect(isWhitelistedAdminEmail("ops@example.com")).toBe(true);
    expect(isWhitelistedAdminEmail("second@example.com")).toBe(true);
    expect(isWhitelistedAdminEmail("blue45f@gmail.com")).toBe(true);
    expect(isWhitelistedAdminEmail("stranger@example.com")).toBe(false);
  });

  it("normalizes email casing and whitespace", () => {
    expect(normalizeAdminEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normalizeAdminEmail(null)).toBe("");
  });

  it("elevates whitelist users to admin while preserving operator role", () => {
    expect(resolveEffectiveAdminRole("user", "blue45f@gmail.com")).toBe("admin");
    expect(resolveEffectiveAdminRole("creator", "blue45f@gmail.com")).toBe("admin");
    expect(resolveEffectiveAdminRole("operator", "blue45f@gmail.com")).toBe("operator");
    expect(resolveEffectiveAdminRole("admin", "blue45f@gmail.com")).toBe("admin");
    expect(resolveEffectiveAdminRole("user", "reader@example.com")).toBe("user");
    expect(resolveEffectiveAdminRole("creator", "reader@example.com")).toBe("creator");
  });
});
