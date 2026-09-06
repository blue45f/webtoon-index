/**
 * Stable browser/server privacy contract for semantic revision documents. Resource token length is
 * the UTF-8 byte length of the original string; digest is lowercase SHA-256 hex.
 */
export const REVISION_COMPARISON_RESOURCE_TOKEN_PREFIX =
  "toonspectrum:resource-sha256:v1:" as const;
export const REVISION_COMPARISON_AI_PROMPT_DIGEST_SENTINEL = "0".repeat(64);

export const REVISION_COMPARISON_PROJECTION_LIMITS = Object.freeze({
  maxDepth: 80,
  maxNodes: 2_000_000,
  maxStringCodeUnits: 16_777_216,
  maxTotalStringCodeUnits: 67_108_864,
  maxArrayLength: 250_000,
  maxObjectKeys: 4_096,
  maxObjectKeyCodeUnits: 4_096,
});

const RESOURCE_URL_PATTERN = /^(?:data|blob):/i;
const RESOURCE_TOKEN_PATTERN =
  /^toonspectrum:resource-sha256:v1:\d+:[0-9a-f]{64}$/u;
const UTF8_ENCODER = new TextEncoder();
const REVISION_COMPARISON_AI_OPERATION_LIMIT = 2_000;
const REVISION_COMPARISON_AI_OPERATION_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const PRIVATE_AI_PROVENANCE_KEYS = new Set([
  "apikey",
  "accesstoken",
  "authtoken",
  "authorization",
  "bearertoken",
  "error",
  "failure",
  "providerrequestid",
  "providersecret",
  "providertoken",
  "prompttext",
  "raw",
  "rawprompt",
  "rawrevisedprompt",
  "rawrevisedprompttext",
  "requestid",
  "revisedprompttext",
  "revisedpromptraw",
  "secret",
  "seed",
  "token",
]);
const LEGACY_AI_PROMPT_DIGEST_KEYS = new Set([
  "promptdigest",
  "prompthash",
  "promptsha256",
  "revisedpromptdigest",
  "revisedprompthash",
  "revisedpromptsha256",
]);

export class RevisionComparisonProjectionError extends Error {
  constructor() {
    // Never retain the source value/cause: revision documents can contain private creator data.
    super("작품 버전 비교 문서를 안전하게 투영할 수 없습니다.");
    this.name = "RevisionComparisonProjectionError";
  }
}

export function isRevisionComparisonResourceToken(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_TOKEN_PATTERN.test(value);
}

interface ProjectionState {
  activeObjects: WeakSet<object>;
  digestCache: Map<string, string>;
  nodes: number;
  totalStringCodeUnits: number;
}

function failProjection(): never {
  throw new RevisionComparisonProjectionError();
}

function consumeNode(state: ProjectionState, depth: number): void {
  if (depth > REVISION_COMPARISON_PROJECTION_LIMITS.maxDepth) failProjection();
  state.nodes += 1;
  if (state.nodes > REVISION_COMPARISON_PROJECTION_LIMITS.maxNodes) failProjection();
}

function consumeString(state: ProjectionState, value: string): void {
  if (value.length > REVISION_COMPARISON_PROJECTION_LIMITS.maxStringCodeUnits) {
    failProjection();
  }
  state.totalStringCodeUnits += value.length;
  if (
    state.totalStringCodeUnits >
    REVISION_COMPARISON_PROJECTION_LIMITS.maxTotalStringCodeUnits
  ) {
    failProjection();
  }
}

function digestHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function resourceToken(value: string, state: ProjectionState): Promise<string> {
  const cached = state.digestCache.get(value);
  if (cached) return cached;

  const encoded = UTF8_ENCODER.encode(value);
  let digest: ArrayBuffer;
  try {
    digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  } catch {
    failProjection();
  }
  const token = `${REVISION_COMPARISON_RESOURCE_TOKEN_PREFIX}${encoded.byteLength}:${digestHex(digest)}`;
  state.digestCache.set(value, token);
  return token;
}

async function projectString(value: string, state: ProjectionState): Promise<string> {
  consumeString(state, value);
  return RESOURCE_URL_PATTERN.test(value) ? resourceToken(value, state) : value;
}

function assertDataProperty(object: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !("value" in descriptor)) failProjection();
  return descriptor.value;
}

function normalizedAiFieldName(key: string): string {
  return key.toLowerCase().replace(/[-_]/gu, "");
}

function isPrivateAiProvenanceField(key: string, parentKey?: string): boolean {
  const normalizedKey = normalizedAiFieldName(key);
  if (
    PRIVATE_AI_PROVENANCE_KEYS.has(normalizedKey) ||
    normalizedKey.startsWith("error") ||
    normalizedKey.startsWith("failure")
  ) {
    return true;
  }
  const normalizedParentKey = parentKey ? normalizedAiFieldName(parentKey) : "";
  return (
    (normalizedParentKey === "prompt" || normalizedParentKey === "revisedprompt") &&
    (normalizedKey === "text" || normalizedKey === "value")
  );
}

function isAiPromptDigestField(key: string, parentKey?: string): boolean {
  const normalizedKey = normalizedAiFieldName(key);
  const normalizedParentKey = parentKey ? normalizedAiFieldName(parentKey) : "";
  return (
    (normalizedParentKey === "prompt" || normalizedParentKey === "revisedprompt") &&
    (normalizedKey === "sha256" || normalizedKey === "digest" || normalizedKey === "hash")
  );
}

function isLegacyAiPromptDigestField(key: string): boolean {
  return LEGACY_AI_PROMPT_DIGEST_KEYS.has(normalizedAiFieldName(key));
}

function assertPlainDataRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) failProjection();
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    failProjection();
  }
  const keys = Object.keys(value);
  if (
    keys.length > REVISION_COMPARISON_PROJECTION_LIMITS.maxObjectKeys ||
    Object.getOwnPropertyNames(value).length !== keys.length
  ) {
    failProjection();
  }
  for (const key of keys) {
    if (key.length > REVISION_COMPARISON_PROJECTION_LIMITS.maxObjectKeyCodeUnits) {
      failProjection();
    }
    assertDataProperty(value, key);
  }
  return value as Record<string, unknown>;
}

function optionalDataProperty(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? assertDataProperty(record, key) : undefined;
}

/**
 * Document-level AI operations are reduced to the exact semantic fields used by the diff engine.
 * Required parser scaffolding uses fixed, non-correlating values so internal operation IDs,
 * provider/model names, timestamps, usage, targets, and reference identifiers never cross the
 * comparison API boundary.
 */
async function projectAiComparisonOperations(
  value: unknown,
  state: ProjectionState,
  depth: number
): Promise<unknown> {
  if (!Array.isArray(value) || value.length > REVISION_COMPARISON_AI_OPERATION_LIMIT) {
    failProjection();
  }
  const keys = Object.keys(value);
  if (
    keys.length !== value.length ||
    Object.getOwnPropertyNames(value).length !== value.length + 1 ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    failProjection();
  }
  const safeOperations: Record<string, unknown>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const indexKey = String(index);
    if (keys[index] !== indexKey) failProjection();
    const source = assertPlainDataRecord(assertDataProperty(value, indexKey));
    const safe: Record<string, unknown> = {
      id: `revision-comparison-operation-${String(index + 1).padStart(6, "0")}`,
      prompt: { sha256: REVISION_COMPARISON_AI_PROMPT_DIGEST_SENTINEL },
      createdAt: REVISION_COMPARISON_AI_OPERATION_TIMESTAMP,
    };
    for (const field of ["kind", "task", "status", "promptVersion"] as const) {
      const fieldValue = optionalDataProperty(source, field);
      if (fieldValue !== undefined) safe[field] = fieldValue;
    }
    const requestedSize = optionalDataProperty(source, "requestedSize");
    if (requestedSize !== undefined) {
      const size = assertPlainDataRecord(requestedSize);
      const width = optionalDataProperty(size, "width");
      const height = optionalDataProperty(size, "height");
      safe.requestedSize = {
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      };
    }
    safeOperations.push(safe);
  }
  return projectValue(safeOperations, state, depth, true, "operations");
}

async function projectValue(
  value: unknown,
  state: ProjectionState,
  depth: number,
  insideAiProvenance: boolean,
  parentKey?: string
): Promise<unknown> {
  consumeNode(state, depth);

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) failProjection();
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") return projectString(value, state);
  if (typeof value !== "object") failProjection();

  if (state.activeObjects.has(value)) failProjection();
  state.activeObjects.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > REVISION_COMPARISON_PROJECTION_LIMITS.maxArrayLength) {
        failProjection();
      }
      const keys = Object.keys(value);
      if (
        keys.length !== value.length ||
        Object.getOwnPropertyNames(value).length !== value.length + 1 ||
        Object.getOwnPropertySymbols(value).length > 0
      ) {
        failProjection();
      }
      const projected: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        if (keys[index] !== key) failProjection();
        projected.push(
          await projectValue(
            assertDataProperty(value, key),
            state,
            depth + 1,
            insideAiProvenance,
            parentKey
          )
        );
      }
      return projected;
    }

    const prototype = Object.getPrototypeOf(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      failProjection();
    }
    const keys = Object.keys(value);
    if (
      keys.length > REVISION_COMPARISON_PROJECTION_LIMITS.maxObjectKeys ||
      Object.getOwnPropertyNames(value).length !== keys.length
    ) {
      failProjection();
    }
    const projected: Record<string, unknown> = {};
    for (const key of keys) {
      if (key.length > REVISION_COMPARISON_PROJECTION_LIMITS.maxObjectKeyCodeUnits) {
        failProjection();
      }
      const propertyValue = assertDataProperty(value, key);
      // Match JSON object serialization used by persisted Studio documents. Optional properties
      // such as `master` can exist as undefined in browser memory and are omitted on the wire.
      if (propertyValue === undefined) continue;
      if (insideAiProvenance && isPrivateAiProvenanceField(key, parentKey)) continue;
      if (insideAiProvenance && isLegacyAiPromptDigestField(key)) continue;
      const normalizedKey = normalizedAiFieldName(key);
      const entersAiProvenance = insideAiProvenance || normalizedKey === "aiprovenance";
      if (
        normalizedKey === "aiprovenance" &&
        (propertyValue === null || typeof propertyValue !== "object")
      ) {
        continue;
      }
      // Legacy provenance occasionally stored a prompt directly as a string instead of the
      // current digest object. Omit that private content while retaining digest-shaped objects.
      if (
        insideAiProvenance &&
        (normalizedKey === "prompt" || normalizedKey === "revisedprompt") &&
        typeof propertyValue === "string"
      ) {
        continue;
      }
      const projectedKey = await projectString(key, state);
      if (Object.hasOwn(projected, projectedKey)) failProjection();
      const projectedPropertyValue = insideAiProvenance && isAiPromptDigestField(key, parentKey)
        ? REVISION_COMPARISON_AI_PROMPT_DIGEST_SENTINEL
        : propertyValue;
      const projectedValue = insideAiProvenance && normalizedKey === "operations"
        ? await projectAiComparisonOperations(projectedPropertyValue, state, depth + 1)
        : await projectValue(
            projectedPropertyValue,
            state,
            depth + 1,
            entersAiProvenance,
            key
          );
      Object.defineProperty(projected, projectedKey, {
        configurable: true,
        enumerable: true,
        value: projectedValue,
        writable: true,
      });
    }
    return projected;
  } finally {
    state.activeObjects.delete(value);
  }
}

/**
 * Produces a JSON-compatible clone suitable for semantic revision comparison. Resource URLs are
 * irreversibly represented by deterministic digest tokens and private AI provenance correlators,
 * raw prompts, errors, and prompt fingerprints are removed. Applying this helper to both the
 * server snapshot and the browser's local project preserves comparable semantics.
 */
export async function projectRevisionComparisonValue(value: unknown): Promise<unknown> {
  return projectValue(
    value,
    {
      activeObjects: new WeakSet<object>(),
      digestCache: new Map<string, string>(),
      nodes: 0,
      totalStringCodeUnits: 0,
    },
    0,
    false
  );
}
