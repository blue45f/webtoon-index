import { randomBytes, randomUUID } from "node:crypto";

import { OAuth2Client } from "google-auth-library";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildAuthRuntimeAclSql,
  buildAuthRuntimeAclViolationSql,
} from "../../../../../../scripts/run-production-database-migrations.mjs";

import type * as DatabaseRuntime from "../../../../../../apps/api/src/db";
import type * as OAuthRuntime from "../../../../../../apps/api/src/server/oauth";

const INTEGRATION_URL =
  process.env.STUDIO_LIVE_POSTGRES_INTEGRATION_URL?.trim();
if (process.env.CI && !INTEGRATION_URL) {
  throw new Error(
    "CI must provide STUDIO_LIVE_POSTGRES_INTEGRATION_URL; OAuth DML-only first-login cannot be skipped",
  );
}
const describeWithDirectPostgres = INTEGRATION_URL ? describe : describe.skip;

describeWithDirectPostgres("OAuth PostgreSQL DML-only runtime", () => {
  let adminPool: Pool | undefined;
  let databaseRuntime: typeof DatabaseRuntime | undefined;
  let oauthRuntime: typeof OAuthRuntime;
  let runtimeRole: string | undefined;
  let testEmail: string | undefined;
  let previousDatabaseUrl: string | undefined;
  let previousGoogleClientId: string | undefined;

  beforeAll(async () => {
    if (!INTEGRATION_URL) throw new Error("integration URL was not provided");

    previousDatabaseUrl = process.env.DATABASE_URL;
    previousGoogleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    adminPool = new Pool({
      application_name: "toonspectrum-oauth-dml-only-observer",
      connectionString: INTEGRATION_URL,
      max: 2,
    });

    runtimeRole = `oauth_runtime_${randomUUID().replaceAll("-", "")}`;
    const runtimePassword = randomBytes(24).toString("hex");
    const runtimeUrl = new URL(INTEGRATION_URL);
    runtimeUrl.username = runtimeRole;
    runtimeUrl.password = runtimePassword;

    await adminPool.query(
      `CREATE ROLE "${runtimeRole}"
         LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
         NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`,
    );
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}"`);
    await adminPool.query(buildAuthRuntimeAclSql(runtimeRole));

    process.env.DATABASE_URL = runtimeUrl.toString();
    process.env.GOOGLE_OAUTH_CLIENT_ID =
      "oauth-runtime-integration.apps.googleusercontent.com";
    databaseRuntime = await import("../../../../../../apps/api/src/db");
    oauthRuntime = await import("../../../../../../apps/api/src/server/oauth");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    const cleanupErrors: unknown[] = [];

    if (databaseRuntime) {
      try {
        await databaseRuntime.dbPool.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (adminPool) {
      try {
        if (testEmail) {
          await adminPool.query('DELETE FROM "user" WHERE "email" = $1', [
            testEmail,
          ]);
        }
        if (runtimeRole) {
          await adminPool.query(`DROP OWNED BY "${runtimeRole}"`);
          await adminPool.query(`DROP ROLE "${runtimeRole}"`);
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await adminPool.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousGoogleClientId === undefined) {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    } else {
      process.env.GOOGLE_OAUTH_CLIENT_ID = previousGoogleClientId;
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "OAuth DML-only integration cleanup failed",
      );
    }
  });

  it("creates and reuses one Google account without runtime DDL privileges", async () => {
    if (!adminPool || !databaseRuntime || !runtimeRole) {
      throw new Error("OAuth DML-only integration runtime was not initialized");
    }

    const providerAccountId = `google-${randomUUID()}`;
    testEmail = `oauth-${randomUUID()}@example.test`;
    vi.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({
      getPayload: () => ({
        sub: providerAccountId,
        email: testEmail,
        email_verified: true,
        iss: "https://accounts.google.com",
        name: "OAuth integration artist",
      }),
    } as never);

    const first = await oauthRuntime.handleGoogleIdToken(
      "header.payload.signature",
    );
    const second = await oauthRuntime.handleGoogleIdToken(
      "header.payload.signature",
    );

    expect(second.id).toBe(first.id);
    expect(second.email).toBe(testEmail);

    const stored = await adminPool.query<{
      accountCount: number;
      userCount: number;
      userId: string;
    }>(
      `SELECT
         count(DISTINCT account."providerAccountId")::integer AS "accountCount",
         count(DISTINCT app_user."id")::integer AS "userCount",
         min(app_user."id") AS "userId"
       FROM "user" AS app_user
       JOIN "account" AS account ON account."userId" = app_user."id"
       WHERE app_user."email" = $1
         AND account."provider" = 'google'
         AND account."providerAccountId" = $2`,
      [testEmail, providerAccountId],
    );
    expect(stored.rows[0]).toEqual({
      accountCount: 1,
      userCount: 1,
      userId: first.id,
    });

    const exactAcl = await adminPool.query<{ exact: boolean }>(
      `SELECT NOT ${buildAuthRuntimeAclViolationSql(runtimeRole)} AS "exact"`,
    );
    expect(exactAcl.rows[0]?.exact).toBe(true);

    await expect(
      databaseRuntime.dbPool.query(
        'ALTER TABLE public."user" ADD COLUMN "oauthRuntimeMustNotCreate" text',
      ),
    ).rejects.toThrow();
  });
});
