import { randomBytes } from "node:crypto";

import pg from "pg";
import { expect, test } from "vitest";

import {
  buildRuntimeLoginGateSql,
  buildRuntimeLoginGateVerificationSql,
  buildRuntimeLoginRestoreSql,
} from "./bootstrap-empty-production-database.mjs";
import {
  VITEST_VALIDATED_REMOTE_DATABASE_MARKER,
  validatePostgresIntegrationUrl,
} from "./run-postgres-integration-tests.mjs";

const { Client } = pg;
const DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() ?? "";

test.runIf(Boolean(DATABASE_URL))(
  "runtime NOLOGIN gate blocks new sessions even while PUBLIC retains CONNECT",
  async () => {
    const target = validatePostgresIntegrationUrl(DATABASE_URL, {
      allowRemoteTestDatabase:
        process.env[VITEST_VALIDATED_REMOTE_DATABASE_MARKER] === "true",
    });
    const suffix = randomBytes(6).toString("hex");
    const runtimeRole = `bootstrap_gate_${suffix}`;
    const runtimePassword = `gate-test-${randomBytes(18).toString("base64url")}`;
    const runtimeUrl = new URL(DATABASE_URL);
    runtimeUrl.username = runtimeRole;
    runtimeUrl.password = runtimePassword;
    const admin = new Client({ connectionString: DATABASE_URL });
    let roleCreated = false;

    await admin.connect();
    try {
      const capability = await admin.query(
        `SELECT rolsuper OR rolcreaterole AS "canCreateRole"
         FROM pg_catalog.pg_roles
         WHERE rolname = current_user`,
      );
      if (capability.rows[0]?.canCreateRole !== true) {
        throw new Error(
          "The disposable bootstrap gate integration database requires CREATEROLE",
        );
      }

      await admin.query(
        `CREATE ROLE ${runtimeRole}
           LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
           NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`,
      );
      roleCreated = true;

      const publicConnect = await admin.query(
        `SELECT EXISTS (
           SELECT 1
           FROM pg_catalog.pg_database AS database_record
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             coalesce(
               database_record.datacl,
               pg_catalog.acldefault('d', database_record.datdba)
             )
           ) AS privilege
           WHERE database_record.datname = current_database()
             AND privilege.grantee = 0
             AND privilege.privilege_type = 'CONNECT'
         ) AS "publicConnect"`,
      );
      expect(publicConnect.rows[0]?.publicConnect).toBe(true);

      const beforeGate = new Client({ connectionString: runtimeUrl.toString() });
      await beforeGate.connect();
      await beforeGate.end();

      await admin.query(
        buildRuntimeLoginGateSql({
          databaseName: target.databaseName,
          runtimeDatabaseRole: runtimeRole,
        }),
      );
      await admin.query(
        buildRuntimeLoginGateVerificationSql({
          databaseName: target.databaseName,
          runtimeDatabaseRole: runtimeRole,
        }),
      );

      const whileGated = new Client({ connectionString: runtimeUrl.toString() });
      await expect(whileGated.connect()).rejects.toThrow();
      await whileGated.end().catch(() => undefined);

      await admin.query(
        buildRuntimeLoginRestoreSql({
          databaseName: target.databaseName,
          runtimeDatabaseRole: runtimeRole,
        }),
      );

      const afterRestore = new Client({ connectionString: runtimeUrl.toString() });
      await afterRestore.connect();
      await afterRestore.end();
    } finally {
      if (roleCreated) {
        await admin
          .query(`ALTER ROLE ${runtimeRole} LOGIN`)
          .catch(() => undefined);
        await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`);
      }
      await admin.end();
    }
  },
);
