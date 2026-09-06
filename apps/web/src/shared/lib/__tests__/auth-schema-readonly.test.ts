import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

const EMPTY_EXECUTE_RESULT = {
  rows: [],
  rowsAffected: 0,
  columns: [],
};
const MUTATING_SQL = /\b(?:alter|create|delete|drop|insert|truncate|update)\b/iu;

function sqlStatements(
  calls: ReadonlyArray<readonly [string | { sql: string; args?: unknown[] }]>,
): string[] {
  return calls.map(([input]) =>
    typeof input === "string" ? input : input.sql,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authentication runtime schema assertions", () => {
  it("checks the user lifecycle schema read-only, caches success, and retries after failure", async () => {
    vi.resetModules();
    const { dbClient } = await import("../../../../../../apps/api/src/db");
    const failure = new Error("user schema unavailable");
    const execute = vi
      .spyOn(dbClient, "execute")
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(EMPTY_EXECUTE_RESULT);
    const { ensureUserLifecycleSchema } = await import("../../../../../../apps/api/src/server/user-lifecycle"
    );

    await expect(ensureUserLifecycleSchema()).rejects.toBe(failure);
    await Promise.all([
      ensureUserLifecycleSchema(),
      ensureUserLifecycleSchema(),
    ]);
    await ensureUserLifecycleSchema();

    expect(execute).toHaveBeenCalledTimes(2);
    const statements = sqlStatements(execute.mock.calls);
    for (const statement of statements) {
      expect(statement.trim()).toMatch(/^SELECT\b/iu);
      expect(statement).toContain('FROM "user"');
      expect(statement).toMatch(/WHERE\s+FALSE/iu);
      expect(statement).not.toMatch(MUTATING_SQL);
    }
    expect(statements[0]).toContain('"status"');
    expect(statements[0]).toContain('"sessionVersion"');
    expect(statements[0]).toContain('"deletedAt"');
  });

  it("checks OAuth tables read-only, caches success, and retries only the failed assertion", async () => {
    vi.resetModules();
    const { dbClient } = await import("../../../../../../apps/api/src/db");
    const failure = new Error("account schema unavailable");
    const execute = vi
      .spyOn(dbClient, "execute")
      .mockResolvedValueOnce(EMPTY_EXECUTE_RESULT)
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(EMPTY_EXECUTE_RESULT);
    const { ensureOAuthTables } = await import("../../../../../../apps/api/src/server/oauth");

    await expect(ensureOAuthTables()).rejects.toBe(failure);
    await Promise.all([ensureOAuthTables(), ensureOAuthTables()]);
    await ensureOAuthTables();

    expect(execute).toHaveBeenCalledTimes(3);
    const statements = sqlStatements(execute.mock.calls);
    expect(statements[0]).toContain('FROM "user"');
    expect(statements.slice(1)).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.trim()).toMatch(/^SELECT\b/iu);
      expect(statement).toMatch(/WHERE\s+FALSE/iu);
      expect(statement).not.toMatch(MUTATING_SQL);
    }
    for (const statement of statements.slice(1)) {
      expect(statement).toContain('FROM "account"');
      expect(statement).toContain('"providerAccountId"');
      expect(statement).toContain('"userId"');
    }
  });

  it("keeps concurrent first-login inserts idempotent and reselects authoritative rows", () => {
    const source = readFileSync(
      new URL("../../../../../../apps/api/src/server/oauth.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("async function upsertOAuthUser(");
    const end = source.indexOf("\nfunction normalizeRole", start);
    const upsertSource = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(upsertSource).toContain(
      ".onConflictDoNothing({ target: users.email })",
    );
    expect(upsertSource).toContain(
      "target: [accounts.provider, accounts.providerAccountId]",
    );
    expect(upsertSource).toContain("const [authoritativeUser]");
    expect(upsertSource).toContain("const [authoritativeAccount]");
    expect(upsertSource).toContain(
      "userId = authoritativeAccount.userId",
    );
  });
});
