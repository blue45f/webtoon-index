export const CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS = 40;

// PostgreSQL's ARE syntax does not need JavaScript's non-capturing groups. This equivalent
// expression keeps the database CHECK constraint aligned with the external contract, including
// the SemVer rule that a numeric prerelease identifier may not have a leading zero.
export const CREATOR_MARKETPLACE_SEMVER_POSTGRES_PATTERN =
  "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(\\.(0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$";
export const CREATOR_MARKETPLACE_LEGACY_SEMVER_POSTGRES_PATTERN =
  "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$";

const CREATOR_MARKETPLACE_EXACT_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const CREATOR_MARKETPLACE_LEGACY_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/u;
const CREATOR_MARKETPLACE_NUMERIC_IDENTIFIER_PATTERN = /^\d+$/u;

interface ParsedCreatorMarketplaceSemver {
  readonly core: readonly [bigint, bigint, bigint];
  readonly prerelease: readonly string[];
}

function parseCreatorMarketplaceSemver(
  value: string,
): ParsedCreatorMarketplaceSemver | null {
  if (
    value.length === 0
    || value.length > CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS
  ) {
    return null;
  }
  const match = CREATOR_MARKETPLACE_EXACT_SEMVER_PATTERN.exec(value);
  if (!match) return null;

  const prerelease = match[4]?.split(".") ?? [];
  if (
    prerelease.some(
      (identifier) =>
        CREATOR_MARKETPLACE_NUMERIC_IDENTIFIER_PATTERN.test(identifier)
        && identifier.length > 1
        && identifier.startsWith("0"),
    )
  ) {
    return null;
  }

  return {
    core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)],
    prerelease,
  };
}

/** Strict, complete SemVer 2.0 validation for externally published releases. */
export function isCreatorMarketplaceSemver(value: string): boolean {
  return parseCreatorMarketplaceSemver(value) !== null;
}

/**
 * Converts the 0021-era accepted version grammar into an equivalent strict SemVer value for
 * precedence checks only. Historical manifests keep their original bytes and hashes; publishers
 * still cannot submit this legacy spelling through the current contract.
 */
export function normalizeCreatorMarketplaceLegacySemver(
  value: string,
): string | null {
  if (isCreatorMarketplaceSemver(value)) return value;
  if (value.length === 0 || value.length > CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS) {
    return null;
  }
  const match = CREATOR_MARKETPLACE_LEGACY_SEMVER_PATTERN.exec(value);
  if (!match) return null;
  const prerelease = match[4]
    ?.split(".")
    .map((identifier) =>
      CREATOR_MARKETPLACE_NUMERIC_IDENTIFIER_PATTERN.test(identifier)
        ? BigInt(identifier).toString()
        : identifier,
    )
    .join(".");
  const normalized = `${match[1]}.${match[2]}.${match[3]}${
    prerelease ? `-${prerelease}` : ""
  }`;
  return isCreatorMarketplaceSemver(normalized) ? normalized : null;
}

/**
 * Suggests the smallest conventional successor used by the Creator Market share form.
 * Prereleases graduate to their stable core; stable releases (including build metadata)
 * advance the patch component without coercing arbitrarily large identifiers to Number.
 */
export function suggestNextCreatorMarketplaceSemver(
  value: string,
): string | null {
  const normalized = normalizeCreatorMarketplaceLegacySemver(value);
  if (!normalized) return null;

  const parsed = parseCreatorMarketplaceSemver(normalized);
  if (!parsed) return null;

  const [major, minor, patch] = parsed.core;
  const suggestion = parsed.prerelease.length > 0
    ? `${major}.${minor}.${patch}`
    : `${major}.${minor}.${patch + BigInt(1)}`;
  return suggestion.length <= CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS
    && isCreatorMarketplaceSemver(suggestion)
    ? suggestion
    : null;
}

function compareBigInts(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  if (left === right) return 0;
  const leftIsNumeric = CREATOR_MARKETPLACE_NUMERIC_IDENTIFIER_PATTERN.test(left);
  const rightIsNumeric = CREATOR_MARKETPLACE_NUMERIC_IDENTIFIER_PATTERN.test(right);
  if (leftIsNumeric && rightIsNumeric) {
    return compareBigInts(BigInt(left), BigInt(right));
  }
  if (leftIsNumeric) return -1;
  if (rightIsNumeric) return 1;
  return left > right ? 1 : -1;
}

/**
 * Compares two validated external release versions by SemVer 2.0 precedence.
 * Build metadata is intentionally ignored, so `1.0.0+one` and `1.0.0+two`
 * have equal precedence and cannot be used to publish two competing releases.
 */
export function compareCreatorMarketplaceSemver(
  left: string,
  right: string,
): number {
  const leftVersion = parseCreatorMarketplaceSemver(left);
  const rightVersion = parseCreatorMarketplaceSemver(right);
  if (!leftVersion || !rightVersion) {
    throw new TypeError("creator_marketplace_semver_invalid");
  }

  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const difference = compareBigInts(
      leftVersion.core[index]!,
      rightVersion.core[index]!,
    );
    if (difference !== 0) return difference;
  }

  if (
    leftVersion.prerelease.length === 0
    && rightVersion.prerelease.length === 0
  ) {
    return 0;
  }
  if (leftVersion.prerelease.length === 0) return 1;
  if (rightVersion.prerelease.length === 0) return -1;

  const sharedLength = Math.min(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = comparePrereleaseIdentifier(
      leftVersion.prerelease[index]!,
      rightVersion.prerelease[index]!,
    );
    if (difference !== 0) return difference;
  }
  if (leftVersion.prerelease.length === rightVersion.prerelease.length) return 0;
  return leftVersion.prerelease.length > rightVersion.prerelease.length ? 1 : -1;
}
