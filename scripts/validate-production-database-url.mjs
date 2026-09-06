#!/usr/bin/env node

import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

const PRODUCTION_QUERY_CONTRACT = new Map([
  ["sslmode", "verify-full"],
  ["channel_binding", "require"],
]);

const FORBIDDEN_EFFECTIVE_HOST_MARKERS = ["pooler", "pgbouncer"];

function fail(message) {
  throw new Error(`Production database URL rejected: ${message}`);
}

function hasControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function decodedPathname(url) {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    fail("database name contains invalid percent encoding");
  }
}

function decodedCredential(value, label) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    fail(`${label} contains invalid percent encoding`);
  }
  if (!decoded || hasControlCharacters(decoded)) {
    fail(`${label} must be non-empty and contain no control characters`);
  }
  return decoded;
}

function normalizedHostname(url) {
  const rawHostname = url.hostname.toLowerCase();
  const hostname =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname;
  if (!hostname) fail("authority must include a hostname");
  if (hostname.includes("%")) {
    fail("percent-encoded hostnames are not allowed");
  }
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1") return true;
  if (isIP(hostname) === 4) {
    const firstOctet = Number(hostname.split(".")[0]);
    return firstOctet === 127;
  }
  return false;
}

function validateDnsHostname(hostname) {
  if (isIP(hostname)) return;
  if (hostname.length > 253) fail("hostname is too long");
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    fail("authority hostname is not a canonical DNS name");
  }
}

/**
 * Validate the effective libpq connection contract before a production DDL
 * process receives the URL. WHATWG URLSearchParams decodes parameter names,
 * so encoded aliases such as `ho%73t` cannot bypass the exact allowlist.
 */
export function validateProductionDatabaseUrl( // NOSONAR javascript:S3776
  rawValue,
  { allowLoopback = false } = {},
) {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) fail("value is missing");
  if (hasControlCharacters(value)) {
    fail("control characters are not allowed");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    fail("value is not a valid absolute URL");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    fail("protocol must be postgresql: or postgres:");
  }
  if (!url.username || !url.password) {
    fail("authority must include non-empty user and password credentials");
  }
  decodedCredential(url.username, "username");
  decodedCredential(url.password, "password");
  if (url.hash) fail("URL fragments are not allowed");

  const hostname = normalizedHostname(url);
  const loopback = isLoopbackHostname(hostname);
  if (!allowLoopback && loopback) {
    fail("production migrations cannot use a loopback endpoint");
  }
  // `localhost` is intentionally not a canonical production DNS name. Once
  // the caller has crossed the explicit disposable-test boundary, do not run
  // that single-label loopback name through the production DNS validator.
  // All non-loopback authorities still require the exact production contract.
  if (!loopback) validateDnsHostname(hostname);
  if (
    !loopback &&
    FORBIDDEN_EFFECTIVE_HOST_MARKERS.some((marker) =>
      hostname.includes(marker),
    )
  ) {
    fail("effective hostname identifies a pooler rather than a direct endpoint");
  }

  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      fail("authority port is invalid");
    }
  }

  const pathname = decodedPathname(url);
  if (
    pathname.length < 2 ||
    pathname.slice(1).includes("/") ||
    pathname.includes("\\") ||
    pathname.includes("\0")
  ) {
    fail("path must identify exactly one non-empty database name");
  }
  if (hasControlCharacters(pathname)) {
    fail("database name contains a control character");
  }

  const seen = new Set();
  for (const [key, queryValue] of url.searchParams) {
    if (!PRODUCTION_QUERY_CONTRACT.has(key)) {
      fail(`query parameter "${key}" is not allowed`);
    }
    if (seen.has(key)) fail(`query parameter "${key}" must appear exactly once`);
    seen.add(key);
    if (queryValue !== PRODUCTION_QUERY_CONTRACT.get(key)) {
      fail(
        `query parameter "${key}" must equal "${PRODUCTION_QUERY_CONTRACT.get(key)}"`,
      );
    }
  }

  if (!loopback || url.search) {
    for (const [key, expectedValue] of PRODUCTION_QUERY_CONTRACT) {
      if (!seen.has(key)) {
        fail(`query parameter "${key}=${expectedValue}" is required`);
      }
    }
  }

  return Object.freeze({
    protocol: url.protocol,
    hostname,
    port: url.port || "5432",
    databaseName: pathname.slice(1),
    tlsVerified: !loopback,
  });
}

/**
 * Convert the already validated URI into dedicated libpq environment fields.
 * This prevents PGHOST/PGSERVICE/PGOPTIONS inherited by a runner from changing
 * the effective connection and keeps the password out of process arguments.
 */
export function createPsqlEnvironment(
  rawValue,
  { allowLoopback = false, baseEnvironment = process.env } = {},
) {
  const contract = validateProductionDatabaseUrl(rawValue, { allowLoopback });
  const url = new URL(rawValue.trim());
  const environment = { ...baseEnvironment };
  for (const key of [
    "PGCONNECT_TIMEOUT",
    "PGDATABASE",
    "PGHOST",
    "PGHOSTADDR",
    "PGOPTIONS",
    "PGPASSFILE",
    "PGPASSWORD",
    "PGPORT",
    "PGREQUIRESSL",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGSSLROOTCERT",
    "PGSSLMODE",
    "PGTARGETSESSIONATTRS",
    "PGUSER",
    "PGCHANNELBINDING",
    // PGSSLROOTCERT=system delegates trust discovery to libpq/OpenSSL. Do not
    // let an inherited OpenSSL override silently replace the platform trust
    // store selected by this release gate.
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
  ]) {
    delete environment[key];
  }
  return {
    ...environment,
    PGHOST: contract.hostname,
    PGPORT: contract.port,
    PGUSER: decodedCredential(url.username, "username"),
    PGPASSWORD: decodedCredential(url.password, "password"),
    PGDATABASE: decodedPathname(url).slice(1),
    PGSSLMODE: contract.tlsVerified ? "verify-full" : "disable",
    PGCHANNELBINDING: contract.tlsVerified ? "require" : "disable",
    ...(contract.tlsVerified ? { PGSSLROOTCERT: "system" } : {}),
  };
}

function parseCliArguments(argv) {
  const allowed = new Set(["--allow-loopback"]);
  for (const argument of argv) {
    if (!allowed.has(argument)) fail(`unknown argument "${argument}"`);
  }
  return { allowLoopback: argv.includes("--allow-loopback") };
}

function runCli() {
  const options = parseCliArguments(process.argv.slice(2));
  validateProductionDatabaseUrl(
    process.env.MIGRATION_DATABASE_URL ??
      process.env.PRODUCTION_DATABASE_DIRECT_URL,
    options,
  );
  process.stdout.write("Production database URL contract: verified\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Database URL validation failed"}\n`,
    );
    process.exitCode = 1;
  }
}
