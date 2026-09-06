#!/usr/bin/env node
/** Real HTTP/session smoke checks. Only a fresh, explicitly opted-in loopback QA DB is allowed. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";

import { verifyPassword } from "../apps/web/src/shared/lib/auth-crypto.ts";
import {
  startIsolatedMarketApi,
  stopIsolatedMarketApi,
  validateIsolatedMarketApiTarget,
} from "./isolated-market-api.mjs";
import { SEED_CONFIRMATION, validateAdminQaTarget } from "./seed/admin-qa-seed.mjs";

const evidenceDirectory = "test-results/admin-hardening";
const checks = [];
let apiProcess;
let privateDirectory;
let client;
let target;

function check(condition, label) {
  assert(condition, label);
  checks.push({ name: label, passed: true });
}

async function request(name, path, options = {}) {
  const method = options.method ?? "GET";
  const headers = { Origin: target.apiOrigin };
  if (options.cookie) headers.Cookie = options.cookie;
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    if (options.csrf !== false) headers["x-toonspectrum-csrf"] = "1";
  }
  const response = await fetch(`${target.apiOrigin}${path}`, {
    method, headers, redirect: "error", signal: AbortSignal.timeout(15_000),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const expected = options.expected ?? (method === "GET" ? [200] : [200, 201]);
  check(expected.includes(response.status), `${name}: HTTP ${response.status}`);
  const text = await response.text();
  const data = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text;
  return { response, data };
}

async function seedAndInspect() {
  const validated = validateAdminQaTarget();
  target = validateIsolatedMarketApiTarget({
    rawApiUrl: "http://127.0.0.1:4107", rawDatabaseUrl: validated.connectionString,
  });
  privateDirectory = await mkdtemp(join(tmpdir(), "toonspectrum-admin-qa-"));
  const privateFile = join(privateDirectory, "credentials.json");
  const seed = spawnSync(process.execPath, [
    "--import", "tsx", "scripts/seed/admin-qa-seed.mjs", "--execute",
    "--confirm", SEED_CONFIRMATION, "--out", privateFile,
  ], { encoding: "utf8", timeout: 30_000, env: process.env });
  check(seed.status === 0, "isolated account seed CLI completed");
  check(((await stat(privateFile)).mode & 0o777) === 0o600, "credential file mode is private");
  const manifest = JSON.parse(await readFile(privateFile, "utf8"));
  check(manifest.accounts.length === 13, "13 role/status fixtures were generated");
  client = new pg.Client({ connectionString: target.databaseUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  const rows = await client.query('SELECT id, role, status, "passwordHash" FROM "user"');
  check(rows.rows.length === 13, "13 accounts were committed to the real QA database");
  for (const account of manifest.accounts) {
    const row = rows.rows.find((entry) => entry.id === account.id);
    check(Boolean(row) && row.role === account.role && row.status === account.status, `${account.key}: persisted role and status`);
    check(account.status === "deleted" ? row.passwordHash === null : verifyPassword(account.password, row.passwordHash), `${account.key}: credential storage contract`);
  }
  return new Map(manifest.accounts.map((account) => [account.key, account]));
}

async function loginAccounts(accounts) {
  const cookies = new Map();
  for (const account of accounts.values()) {
    if (account.status !== "active") continue;
    const { response, data } = await request(`${account.key}: login`, "/api/auth/login", {
      method: "POST", body: { email: account.email, password: account.password },
    });
    check(data.ok === true && data.user?.id === account.id && data.user?.role === account.role, `${account.key}: canonical login principal`);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("toonspectrum-auth-session="));
    check(typeof cookie === "string" && /httponly/i.test(cookie), `${account.key}: HttpOnly session cookie`);
    cookies.set(account.key, cookie.split(";")[0]);
    const session = await request(`${account.key}: session`, "/api/auth/session", { cookie: cookies.get(account.key) });
    check(session.data.authenticated === true && session.data.user?.id === account.id, `${account.key}: real cookie session resolves`);
  }
  // Five active + four suspended + one deleted attempt stay within the real 10-login policy.
  for (const account of accounts.values()) {
    if (account.status !== "suspended") continue;
    await request(`${account.key}: blocked login`, "/api/auth/login", {
      method: "POST", body: { email: account.email, password: account.password }, expected: [403],
    });
  }
  const deleted = accounts.get("user-deleted");
  await request("deleted account has no reusable credential", "/api/auth/login", {
    method: "POST", body: { email: deleted.email, password: "nonexistent-qa-credential" }, expected: [401],
  });
  return cookies;
}

async function verifyReads(cookies) {
  await request("anonymous admin access denied", "/api/admin/users", { expected: [401, 403] });
  for (const key of ["user-active", "creator-active"]) {
    await request(`${key}: admin access denied`, "/api/admin/me", { cookie: cookies.get(key), expected: [403] });
  }
  await request("operator can inspect own admin identity", "/api/admin/me", { cookie: cookies.get("operator-active") });
  await request("operator can inspect members", "/api/admin/users?limit=25", { cookie: cookies.get("operator-active") });
  const cookie = cookies.get("admin-active");
  const readPaths = [
    "me", "users?limit=25", "config", "plans", "revenue?days=30&status=all", "campaigns",
    "announcements", "promos", "reports", "audit-logs?limit=10", "security/ip-rules",
    "moderation/banned-words", "community/posts", "moderation/reviews", "moderation/comments",
    "dashboard?days=30", "system/health",
  ];
  for (const path of readPaths) {
    const { data } = await request(`admin read ${path}`, `/api/admin/${path}`, { cookie });
    check(data !== null && typeof data === "object", `admin read ${path}: JSON response`);
  }
  for (const kind of ["users", "revenue"]) {
    const { response, data } = await request(`${kind}: CSV export`, `/api/admin/${kind}/export/csv`, { cookie });
    check(response.headers.get("cache-control")?.includes("no-store"), `${kind}: CSV is not cached`);
    check(response.headers.get("content-type")?.includes("text/csv") && typeof data === "string", `${kind}: CSV media type`);
  }
}

async function verifyWrites(accounts, cookies) {
  const targetAccount = accounts.get("mutation-target");
  const targetId = encodeURIComponent(targetAccount.id);
  const adminAccount = accounts.get("admin-active");
  const adminCookie = cookies.get("admin-active");
  const operatorCookie = cookies.get("operator-active");
  const deniedWrites = [
    [`users/${targetId}/role`, "POST", { role: "admin" }],
    [`users/${targetId}/status`, "POST", { status: "suspended" }],
    [`users/${targetId}`, "DELETE", { reason: "QA" }],
    ["users/bulk-status", "POST", { userIds: [targetAccount.id], status: "suspended" }],
  ];
  for (const [path, method, body] of deniedWrites) {
    await request(`operator denied ${path}`, `/api/admin/${path}`, { cookie: operatorCookie, method, body, expected: [403] });
  }
  const unchanged = await client.query('SELECT role, status FROM "user" WHERE id = $1', [targetAccount.id]);
  check(unchanged.rows[0].role === "user" && unchanged.rows[0].status === "active", "denied operator requests did not mutate the target");
  await request("member writes require CSRF proof", `/api/admin/users/${targetId}/role`, {
    cookie: adminCookie, method: "POST", body: { role: "creator" }, csrf: false, expected: [403],
  });
  await request("admin cannot change own role", `/api/admin/users/${encodeURIComponent(adminAccount.id)}/role`, {
    cookie: adminCookie, method: "POST", body: { role: "user" }, expected: [400],
  });
  for (const [path, body] of [
    ["system/maintenance", { enabled: "false" }],
    ["security/ip-rules", { ipAddress: "192.0.2.1/24junk" }],
    ["users/bulk-status", { userIds: [null], status: "suspended" }],
    ["users/bulk-status", { userIds: Array.from({ length: 201 }, () => targetAccount.id), status: "suspended" }],
  ]) {
    await request(`invalid admin command ${path}`, `/api/admin/${path}`, { cookie: adminCookie, method: "POST", body, expected: [400] });
  }
  await request("administrator changes target role", `/api/admin/users/${targetId}/role`, {
    cookie: adminCookie, method: "POST", body: { role: "creator" },
  });
  const filtered = await request("member filters use persisted role", `/api/admin/users?q=${encodeURIComponent(targetAccount.email)}&role=creator&status=active&limit=1&offset=0`, { cookie: adminCookie });
  check(filtered.data.items?.length === 1 && filtered.data.items[0].id === targetAccount.id, "member query returns the exact QA target");
  const details = await request("member details", `/api/admin/users/${targetId}/details`, { cookie: adminCookie });
  check(details.data.user?.role === "creator", "member details reflect persisted role");
  for (const status of ["suspended", "active"]) {
    await request(`administrator changes target status to ${status}`, `/api/admin/users/${targetId}/status`, {
      cookie: adminCookie, method: "POST", body: { status, reason: "isolated QA" },
    });
    const staleSession = await request(`old session after ${status}`, "/api/auth/session", { cookie: cookies.get("mutation-target") });
    check(staleSession.data.authenticated === false, `previous session remains invalid after ${status}`);
  }
}

async function main() {
  await mkdir(evidenceDirectory, { recursive: true });
  try {
    const accounts = await seedAndInspect();
    apiProcess = await startIsolatedMarketApi(target);
    const cookies = await loginAccounts(accounts);
    await verifyReads(cookies);
    await verifyWrites(accounts, cookies);
    const report = { success: true, fixtureAccounts: 13, realSuccessfulLogins: 5, blockedLoginChecks: 5, assertionCount: checks.length, checks };
    await writeFile(join(evidenceDirectory, "live-qa.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, checks: undefined }));
  } catch (error) {
    await writeFile(join(evidenceDirectory, "live-qa.json"), `${JSON.stringify({ success: false, completedChecks: checks, error: error instanceof Error ? error.message : "QA failure" }, null, 2)}\n`);
    throw error;
  } finally {
    if (apiProcess) await stopIsolatedMarketApi(apiProcess);
    if (client) await client.end();
    if (privateDirectory) await rm(privateDirectory, { recursive: true, force: true });
  }
}

await main();
