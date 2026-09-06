import { describe, expect, it } from "vitest";

import {
  POSTGRES_INTEGRATION_SUITES,
  VITEST_UNAVAILABLE_DATABASE_URL,
  VITEST_VALIDATED_REMOTE_DATABASE_MARKER,
  createPostgresIntegrationEnvironment,
  createVitestArguments,
  parsePostgresIntegrationArguments,
  resolvePostgresIntegrationTarget,
  resolveVitestDatabaseTarget,
  validatePostgresIntegrationUrl,
} from "./run-postgres-integration-tests.mjs";

const LOCAL_URL =
  "postgresql://webdex:local-secret@127.0.0.1:55432/webdex";
const REMOTE_TEST_URL =
  "postgresql://ci:remote-secret@db.example.test/toonspectrum_integration?sslmode=verify-full&channel_binding=require";
const REMOTE_PRODUCTION_URL =
  "postgresql://app:production-secret@db.example.com/toonspectrum?sslmode=verify-full";
const RUNTIME_ROLE = "webdex_runtime";

describe("PostgreSQL integration test runner", () => {
  it("requires a dedicated TEST_DATABASE_URL instead of inheriting DATABASE_URL", () => {
    expect(() =>
      resolvePostgresIntegrationTarget({
        environment: { DATABASE_URL: REMOTE_PRODUCTION_URL },
      }),
    ).toThrow(/dedicated test database/u);
  });

  it("keeps root Vitest away from production DATABASE_URL and .env.local fallbacks", () => {
    const target = resolveVitestDatabaseTarget({
      environment: { DATABASE_URL: REMOTE_PRODUCTION_URL },
      envFileDatabaseUrl: REMOTE_PRODUCTION_URL,
    });

    expect(target).toMatchObject({
      databaseUrl: VITEST_UNAVAILABLE_DATABASE_URL,
      enabled: false,
      source: "unavailable-loopback",
    });
  });

  it("uses explicit test URL first and accepts only safe loopback fallbacks", () => {
    expect(
      resolveVitestDatabaseTarget({
        environment: {
          DATABASE_URL: LOCAL_URL.replace("webdex", "ignored"),
          TEST_DATABASE_URL: LOCAL_URL,
        },
        envFileDatabaseUrl: LOCAL_URL.replace("webdex", "also_ignored"),
      }),
    ).toMatchObject({ databaseUrl: LOCAL_URL, enabled: true, source: "TEST_DATABASE_URL" });

    expect(
      resolveVitestDatabaseTarget({
        environment: { DATABASE_URL: LOCAL_URL },
        envFileDatabaseUrl: REMOTE_PRODUCTION_URL,
      }),
    ).toMatchObject({ databaseUrl: LOCAL_URL, enabled: true, source: "DATABASE_URL" });

    expect(
      resolveVitestDatabaseTarget({
        environment: {},
        envFileDatabaseUrl: LOCAL_URL,
      }),
    ).toMatchObject({ databaseUrl: LOCAL_URL, enabled: true, source: ".env.local" });
  });

  it("requires the validated runner boundary for remote disposable Vitest targets", () => {
    expect(() =>
      resolveVitestDatabaseTarget({
        environment: { TEST_DATABASE_URL: REMOTE_TEST_URL, NODE_ENV: "test" },
      }),
    ).toThrow(/Remote PostgreSQL targets are blocked/u);

    expect(
      resolveVitestDatabaseTarget({
        environment: {
          TEST_DATABASE_URL: REMOTE_TEST_URL,
          NODE_ENV: "test",
          [VITEST_VALIDATED_REMOTE_DATABASE_MARKER]: "true",
        },
      }),
    ).toMatchObject({
      databaseUrl: REMOTE_TEST_URL,
      enabled: true,
      loopback: false,
      source: "TEST_DATABASE_URL",
    });
  });

  it("accepts one explicit CLI or environment test URL and rejects ambiguity", () => {
    expect(
      resolvePostgresIntegrationTarget({
        arguments_: [
          "--database-url",
          LOCAL_URL,
          "--runtime-database-role",
          RUNTIME_ROLE,
        ],
        environment: {},
      }).loopback,
    ).toBe(true);
    expect(
      resolvePostgresIntegrationTarget({
        environment: {
          TEST_DATABASE_URL: LOCAL_URL,
          TEST_RUNTIME_DATABASE_ROLE: RUNTIME_ROLE,
        },
      }).databaseName,
    ).toBe("webdex");
    expect(() =>
      resolvePostgresIntegrationTarget({
        arguments_: ["--database-url", LOCAL_URL],
        environment: {
          TEST_DATABASE_URL: LOCAL_URL.replace("webdex", "other"),
          TEST_RUNTIME_DATABASE_ROLE: RUNTIME_ROLE,
        },
      }),
    ).toThrow(/Conflicting/u);
  });

  it("requires one validated runtime role for the owner-backed test target", () => {
    expect(() =>
      resolvePostgresIntegrationTarget({
        environment: { TEST_DATABASE_URL: LOCAL_URL },
      }),
    ).toThrow(/lowercase PostgreSQL role name/u);
    expect(() =>
      resolvePostgresIntegrationTarget({
        arguments_: [
          "--database-url",
          LOCAL_URL,
          "--runtime-database-role",
          "Webdex_Runtime",
        ],
        environment: {},
      }),
    ).toThrow(/lowercase PostgreSQL role name/u);
    expect(() =>
      resolvePostgresIntegrationTarget({
        arguments_: [
          "--database-url",
          LOCAL_URL,
          "--runtime-database-role",
          RUNTIME_ROLE,
        ],
        environment: {
          TEST_RUNTIME_DATABASE_ROLE: "other_runtime",
        },
      }),
    ).toThrow(/Conflicting runtime database roles/u);
  });

  it("blocks remote and production targets unless every test-only guard passes", () => {
    expect(() => validatePostgresIntegrationUrl(REMOTE_TEST_URL)).toThrow(
      /Remote PostgreSQL targets are blocked/u,
    );
    expect(
      validatePostgresIntegrationUrl(REMOTE_TEST_URL, {
        allowRemoteTestDatabase: true,
        environment: { CI: "true", NODE_ENV: "test" },
      }).loopback,
    ).toBe(false);
    expect(() =>
      validatePostgresIntegrationUrl(REMOTE_PRODUCTION_URL, {
        allowRemoteTestDatabase: true,
        environment: { CI: "true", NODE_ENV: "test" },
      }),
    ).toThrow(/disposable test database/u);
    expect(() =>
      validatePostgresIntegrationUrl(LOCAL_URL, {
        environment: { NODE_ENV: "production" },
      }),
    ).toThrow(/disabled inside a production runtime/u);
  });

  it("rejects authority overrides, unknown parameters, and weak remote TLS", () => {
    expect(() =>
      validatePostgresIntegrationUrl(`${LOCAL_URL}?host=production.internal`),
    ).toThrow(/forbidden connection override/u);
    expect(() =>
      validatePostgresIntegrationUrl(`${LOCAL_URL}?application_name=unsafe`),
    ).toThrow(/unsupported connection parameter/u);
    expect(() =>
      validatePostgresIntegrationUrl(
        REMOTE_TEST_URL.replace("verify-full", "disable"),
        {
          allowRemoteTestDatabase: true,
          environment: { NODE_ENV: "test" },
        },
      ),
    ).toThrow(/requires sslmode=verify-full/u);
    expect(() =>
      validatePostgresIntegrationUrl(
        REMOTE_TEST_URL.replace("&channel_binding=require", ""),
        {
          allowRemoteTestDatabase: true,
          environment: { NODE_ENV: "test" },
        },
      ),
    ).toThrow(/channel_binding=require/u);
  });

  it("injects only the selected test target over inherited database variables", () => {
    const childEnvironment = createPostgresIntegrationEnvironment(
      LOCAL_URL,
      {
        DATABASE_URL: REMOTE_PRODUCTION_URL,
        NODE_ENV: "development",
        STUDIO_LIVE_POSTGRES_INTEGRATION_URL: REMOTE_PRODUCTION_URL,
        STUDIO_LIVE_POSTGRES_RUNTIME_ROLE: "unsafe_inherited_role",
        STUDIO_TEAM_COMMENT_POSTGRES_INTEGRATION_URL: REMOTE_PRODUCTION_URL,
      },
      { runtimeDatabaseRole: RUNTIME_ROLE },
    );

    expect(childEnvironment.NODE_ENV).toBe("test");
    expect(childEnvironment.DATABASE_URL).toBe(LOCAL_URL);
    expect(childEnvironment.TEST_DATABASE_URL).toBe(LOCAL_URL);
    expect(childEnvironment[VITEST_VALIDATED_REMOTE_DATABASE_MARKER]).toBe("false");
    expect(childEnvironment.STUDIO_LIVE_POSTGRES_INTEGRATION_URL).toBe(
      LOCAL_URL,
    );
    expect(childEnvironment.STUDIO_LIVE_POSTGRES_RUNTIME_ROLE).toBe(
      RUNTIME_ROLE,
    );
    expect(childEnvironment.STUDIO_TEAM_COMMENT_POSTGRES_INTEGRATION_URL).toBe(
      LOCAL_URL,
    );

    expect(
      createPostgresIntegrationEnvironment(REMOTE_TEST_URL, {}, {
        runtimeDatabaseRole: RUNTIME_ROLE,
        validatedRemoteDatabase: true,
      })[VITEST_VALIDATED_REMOTE_DATABASE_MARKER],
    ).toBe("true");
  });

  it("runs exactly the ten direct PostgreSQL suites without file parallelism", () => {
    expect(POSTGRES_INTEGRATION_SUITES).toHaveLength(10);
    expect(new Set(POSTGRES_INTEGRATION_SUITES)).toHaveProperty("size", 10);
    expect(POSTGRES_INTEGRATION_SUITES).toContain(
      "scripts/bootstrap-runtime-login-gate.integration.test.mjs",
    );
    expect(POSTGRES_INTEGRATION_SUITES).toContain(
      "apps/web/src/shared/lib/__tests__/oauth-runtime.integration.test.ts",
    );
    expect(
      POSTGRES_INTEGRATION_SUITES.every((suite) =>
        /\.integration\.test\.(?:mjs|ts)$/u.test(suite),
      ),
    ).toBe(true);

    const vitestArguments = createVitestArguments();
    expect(vitestArguments).toContain("--no-file-parallelism");
    expect(
      vitestArguments.slice(-POSTGRES_INTEGRATION_SUITES.length),
    ).toEqual(POSTGRES_INTEGRATION_SUITES);
    expect(
      vitestArguments.some((argument) => argument.includes("secret")),
    ).toBe(false);
  });

  it("keeps help and repeated sensitive arguments deterministic", () => {
    expect(parsePostgresIntegrationArguments(["--", "--help"])).toEqual({
      allowRemoteTestDatabase: false,
      databaseUrl: undefined,
      help: true,
      runtimeDatabaseRole: undefined,
    });
    expect(() =>
      parsePostgresIntegrationArguments([
        "--database-url",
        LOCAL_URL,
        "--database-url",
        LOCAL_URL,
      ]),
    ).toThrow(/exactly once/u);
    expect(() =>
      parsePostgresIntegrationArguments([
        "--runtime-database-role",
        RUNTIME_ROLE,
        `--runtime-database-role=${RUNTIME_ROLE}`,
      ]),
    ).toThrow(/exactly once/u);
    expect(() =>
      parsePostgresIntegrationArguments(["--not-a-real-option"]),
    ).toThrow(/Unsupported/u);
  });
});
