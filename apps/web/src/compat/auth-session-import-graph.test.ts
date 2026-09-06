import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("auth session import graph", () => {
  it("keeps the shared API client below the React auth facade without an ineffective dynamic edge", () => {
    const authStore = readFileSync(join(process.cwd(), "apps/web/src/compat/auth-session-store.ts"), "utf8");
    const apiClient = readFileSync(join(process.cwd(), "apps/web/src/infrastructure/api.ts"), "utf8");

    expect(authStore).not.toMatch(/import\s*\(\s*["']@\/src\/infrastructure\/api["']\s*\)/);
    expect(authStore).toContain('import { api, apiPath } from "@/src/infrastructure/api"');
    expect(apiClient).not.toContain("@/src/compat/auth-session-store");
    expect(apiClient).toContain("@/src/compat/auth-session-state");
  });
});
