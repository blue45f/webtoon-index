type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

const INVALID_CANONICAL_JSON = Symbol("invalid-studio-bg3d-physics-session-value");

function canonicalizePhysicsSessionValue(
  value: unknown,
  ancestors: Set<object>,
): CanonicalJson | undefined | typeof INVALID_CANONICAL_JSON {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : INVALID_CANONICAL_JSON;
  }
  if (typeof value !== "object") return INVALID_CANONICAL_JSON;
  if (ancestors.has(value)) return INVALID_CANONICAL_JSON;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: CanonicalJson[] = [];
      for (const item of value) {
        const canonical = canonicalizePhysicsSessionValue(item, ancestors);
        if (canonical === undefined || canonical === INVALID_CANONICAL_JSON) {
          return INVALID_CANONICAL_JSON;
        }
        result.push(canonical);
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID_CANONICAL_JSON;
    const record = value as Record<string, unknown>;
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(record).sort()) {
      const canonical = canonicalizePhysicsSessionValue(record[key], ancestors);
      if (canonical === INVALID_CANONICAL_JSON) return INVALID_CANONICAL_JSON;
      if (canonical !== undefined) result[key] = canonical;
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Creates a deterministic token for the editor-owned inputs used to start a physics job.
 *
 * Physics runs asynchronously in a Worker. This token lets the caller reject a completed or baked
 * result when any primitive, model authoring property, or base document changed in the meantime.
 * Unsupported values and cycles fail closed instead of collapsing to JSON `null`/omitted fields.
 */
export function createStudioBg3dPhysicsSessionSourceToken(value: unknown): string | null {
  const canonical = canonicalizePhysicsSessionValue(value, new Set());
  if (canonical === undefined || canonical === INVALID_CANONICAL_JSON) return null;
  try {
    return JSON.stringify(canonical);
  } catch {
    return null;
  }
}

export function isStudioBg3dPhysicsSessionSourceCurrent(
  expectedToken: string,
  currentValue: unknown,
): boolean {
  if (typeof expectedToken !== "string" || expectedToken.length === 0) return false;
  const currentToken = createStudioBg3dPhysicsSessionSourceToken(currentValue);
  return currentToken !== null && currentToken === expectedToken;
}
