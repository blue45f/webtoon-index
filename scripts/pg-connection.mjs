const LEGACY_FULL_VERIFICATION_SSL_MODES = new Set(["prefer", "require", "verify-ca"]);

function isNeonHost(hostname) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "neon.tech" || normalized.endsWith(".neon.tech");
}

/**
 * Keep maintenance scripts on the same certificate + hostname verification
 * contract as the application without combining connection-string SSL options
 * with a separate node-postgres `ssl` object.
 */
export function normalizePgConnectionStringForTls(connectionString) {
  const parsed = new URL(connectionString);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }

  const sslModes = parsed.searchParams.getAll("sslmode");
  if (sslModes.length > 1) {
    throw new Error("DATABASE_URL must not repeat sslmode");
  }

  const sslMode = sslModes[0]?.trim().toLowerCase();
  const neon = isNeonHost(parsed.hostname);
  if (neon && sslMode === "disable") {
    throw new Error("Neon DATABASE_URL must not disable TLS");
  }

  if ((sslMode && LEGACY_FULL_VERIFICATION_SSL_MODES.has(sslMode)) || (neon && !sslMode)) {
    parsed.searchParams.set("sslmode", "verify-full");
  }

  return parsed.toString();
}
