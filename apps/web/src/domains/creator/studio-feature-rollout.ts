/**
 * Generic, local-first feature rollout policy for Studio.
 *
 * The resolver is deliberately synchronous and network-free. A caller may feed it a policy fetched
 * elsewhere, but evaluation, stable cohort assignment, last-known-good recovery, kill switches,
 * dependency gates, and failure cooldowns never require a server round-trip.
 */

export const STUDIO_FEATURE_ROLLOUT_SCHEMA_VERSION = 1 as const;
export const STUDIO_FEATURE_ROLLOUT_BUCKET_COUNT = 10_000;
export const STUDIO_FEATURE_ROLLOUT_STORAGE_PREFIX =
  "toonspectrum:studio:feature-rollout:v1";

const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const CHECKSUM_PATTERN = /^fnv1a32:[0-9a-f]{8}$/u;
const MAX_POLICY_DEPENDENCIES = 64;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface StudioFeatureRolloutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface StudioFeatureRolloutRandom {
  getRandomValues(array: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer>;
}

export type StudioFeatureRolloutEnvironment =
  | "production"
  | "development"
  | "test";

export type StudioFeatureRolloutAuthority = "build" | "validated-remote";

export interface StudioFeatureRolloutPolicy {
  readonly schemaVersion: typeof STUDIO_FEATURE_ROLLOUT_SCHEMA_VERSION;
  readonly featureId: string;
  readonly policyVersion: number;
  readonly authority: StudioFeatureRolloutAuthority;
  readonly issuedAtMs: number;
  /**
   * Build policies may be non-expiring. Validated remote policies always require a finite expiry so
   * an abandoned control plane cannot silently leave an experiment enabled forever.
   */
  readonly expiresAtMs: number | null;
  readonly rolloutPercent: number;
  readonly killSwitch: boolean;
  readonly dependencies: readonly string[];
}

export type StudioFeatureRolloutQaOverride = "force-on" | "force-off";

export interface StudioFeatureRolloutFailureGuard {
  readonly threshold: number;
  readonly cooldownMs: number;
}

export type StudioFeatureRolloutDecisionReason =
  | "policy-unavailable"
  | "policy-invalid"
  | "policy-unvalidated"
  | "policy-expired"
  | "policy-issued-in-future"
  | "policy-storage-unavailable"
  | "last-known-good-corrupt"
  | "policy-conflict"
  | "kill-switch"
  | "dependency-disabled"
  | "failure-state-unavailable"
  | "failure-state-corrupt"
  | "failure-cooldown"
  | "qa-force-on"
  | "qa-force-off"
  | "rollout-disabled"
  | "rollout-full"
  | "cohort-included"
  | "cohort-excluded"
  | "cohort-unavailable";

export type StudioFeatureRolloutPolicySource =
  | "incoming"
  | "last-known-good"
  | "none";

export type StudioFeatureRolloutPolicySelection =
  | "incoming-build"
  | "incoming-persisted"
  | "last-known-good-fallback"
  | "last-known-good-newer"
  | "none";

export interface StudioFeatureRolloutDecision {
  readonly enabled: boolean;
  readonly featureId: string;
  readonly reason: StudioFeatureRolloutDecisionReason;
  readonly policySource: StudioFeatureRolloutPolicySource;
  readonly policySelection: StudioFeatureRolloutPolicySelection;
  readonly policyVersion: number | null;
  readonly policyChecksum: string | null;
  readonly rolloutPercent: number;
  readonly bucket: number | null;
  readonly evaluatedAtMs: number;
  readonly dependencies: readonly string[];
}

export interface ResolveStudioFeatureRolloutInput {
  readonly featureId: string;
  readonly policy?: unknown;
  /**
   * The remote fetch/verification boundary must set this only after signature/authenticity checks.
   * Build policies are trusted by virtue of shipping in the application bundle.
   */
  readonly policyValidated?: boolean;
  readonly environment: StudioFeatureRolloutEnvironment;
  readonly nowMs: number;
  readonly storage?: StudioFeatureRolloutStorage | null;
  readonly random?: StudioFeatureRolloutRandom | null;
  readonly dependencyDecisions?: Readonly<Record<string, boolean>>;
  readonly qaOverride?: unknown;
  readonly qaOverrideAuthorized?: boolean;
  readonly failureGuard?: StudioFeatureRolloutFailureGuard | null;
  /**
   * Adapter-only compatibility hook for an already-shipped cohort key. New features should omit it
   * and use the namespaced per-feature key.
   */
  readonly bucketStorageKey?: string;
}

export interface ResolveStudioFeatureCohortInput {
  readonly rolloutPercent: number;
  readonly storageKey: string;
  readonly storage?: StudioFeatureRolloutStorage | null;
  readonly random?: StudioFeatureRolloutRandom | null;
}

export interface StudioFeatureCohortDecision {
  readonly included: boolean;
  readonly bucket: number | null;
  readonly reason:
    | "rollout-disabled"
    | "rollout-full"
    | "cohort-included"
    | "cohort-excluded"
    | "cohort-unavailable";
}

export type StudioFeatureRolloutErrorCode =
  | "invalid-policy"
  | "invalid-feature-id"
  | "invalid-policy-version"
  | "invalid-policy-time"
  | "invalid-rollout-percent"
  | "invalid-dependency"
  | "duplicate-feature"
  | "dependency-cycle";

export class StudioFeatureRolloutError extends Error {
  readonly code: StudioFeatureRolloutErrorCode;
  readonly path: string;

  constructor(code: StudioFeatureRolloutErrorCode, path: string, message: string) {
    super(message);
    this.name = "StudioFeatureRolloutError";
    this.code = code;
    this.path = path;
  }
}

interface StudioFeatureRolloutLastKnownGoodEnvelope {
  readonly schemaVersion: typeof STUDIO_FEATURE_ROLLOUT_SCHEMA_VERSION;
  readonly policy: StudioFeatureRolloutPolicy;
  readonly checksum: string;
}

interface StudioFeatureRolloutFailureState {
  readonly schemaVersion: typeof STUDIO_FEATURE_ROLLOUT_SCHEMA_VERSION;
  readonly featureId: string;
  readonly policyVersion: number;
  readonly failureCount: number;
  readonly lastFailureAtMs: number;
  readonly disabledUntilMs: number;
}

interface StudioFeatureRolloutFailureEnvelope {
  readonly state: StudioFeatureRolloutFailureState;
  readonly checksum: string;
}

type StoredPolicyResult =
  | { readonly state: "missing" | "unavailable" | "corrupt"; readonly policy: null }
  | {
      readonly state: "valid";
      readonly policy: StudioFeatureRolloutPolicy;
      readonly checksum: string;
    };

type FailureStateResult =
  | { readonly state: "missing" | "unavailable" | "corrupt"; readonly value: null }
  | { readonly state: "valid"; readonly value: StudioFeatureRolloutFailureState };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function validSafeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum;
}

function assertFeatureId(value: unknown, path: string): asserts value is string {
  if (
    typeof value !== "string"
    || value.length > 128
    || !FEATURE_ID_PATTERN.test(value)
  ) {
    throw new StudioFeatureRolloutError(
      "invalid-feature-id",
      path,
      `${path} must be a lowercase dotted or dashed feature id`,
    );
  }
}

function canonicalJsonValue(value: unknown, seen: Set<object>): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical rollout JSON cannot contain a non-finite number");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("canonical rollout JSON cannot contain a cycle");
    seen.add(value);
    const next = value.map((entry) => canonicalJsonValue(entry, seen));
    seen.delete(value);
    return next;
  }
  if (!isRecord(value)) {
    throw new TypeError("canonical rollout JSON supports only plain JSON values");
  }
  if (seen.has(value)) throw new TypeError("canonical rollout JSON cannot contain a cycle");
  seen.add(value);
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) {
      throw new TypeError("canonical rollout JSON cannot contain undefined");
    }
    next[key] = canonicalJsonValue(value[key], seen);
  }
  seen.delete(value);
  return next;
}

export function canonicalStudioFeatureRolloutJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value, new Set<object>()));
}

export function checksumStudioFeatureRolloutValue(value: unknown): string {
  const text = canonicalStudioFeatureRolloutJson(value);
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function normalizeStudioFeatureRolloutPolicy(
  value: unknown,
): StudioFeatureRolloutPolicy {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "schemaVersion",
      "featureId",
      "policyVersion",
      "authority",
      "issuedAtMs",
      "expiresAtMs",
      "rolloutPercent",
      "killSwitch",
      "dependencies",
    ])
    || value.schemaVersion !== STUDIO_FEATURE_ROLLOUT_SCHEMA_VERSION
  ) {
    throw new StudioFeatureRolloutError(
      "invalid-policy",
      "policy",
      "policy must use the exact Studio feature rollout v1 schema",
    );
  }
  assertFeatureId(value.featureId, "policy.featureId");
  if (!validSafeInteger(value.policyVersion, 1)) {
    throw new StudioFeatureRolloutError(
      "invalid-policy-version",
      "policy.policyVersion",
      "policyVersion must be a positive safe integer",
    );
  }
  if (value.authority !== "build" && value.authority !== "validated-remote") {
    throw new StudioFeatureRolloutError(
      "invalid-policy",
      "policy.authority",
      "authority must be build or validated-remote",
    );
  }
  if (!validSafeInteger(value.issuedAtMs)) {
    throw new StudioFeatureRolloutError(
      "invalid-policy-time",
      "policy.issuedAtMs",
      "issuedAtMs must be a non-negative safe integer",
    );
  }
  const expiresAtMs = value.expiresAtMs;
  if (
    expiresAtMs !== null
    && (
      !validSafeInteger(expiresAtMs)
      || expiresAtMs <= value.issuedAtMs
    )
  ) {
    throw new StudioFeatureRolloutError(
      "invalid-policy-time",
      "policy.expiresAtMs",
      "expiresAtMs must be null or later than issuedAtMs",
    );
  }
  if (value.authority === "validated-remote" && expiresAtMs === null) {
    throw new StudioFeatureRolloutError(
      "invalid-policy-time",
      "policy.expiresAtMs",
      "validated remote policies require an expiry",
    );
  }
  if (
    typeof value.rolloutPercent !== "number"
    || !Number.isFinite(value.rolloutPercent)
    || value.rolloutPercent < 0
    || value.rolloutPercent > 100
  ) {
    throw new StudioFeatureRolloutError(
      "invalid-rollout-percent",
      "policy.rolloutPercent",
      "rolloutPercent must be a finite number from 0 to 100",
    );
  }
  if (typeof value.killSwitch !== "boolean") {
    throw new StudioFeatureRolloutError(
      "invalid-policy",
      "policy.killSwitch",
      "killSwitch must be boolean",
    );
  }
  if (
    !Array.isArray(value.dependencies)
    || value.dependencies.length > MAX_POLICY_DEPENDENCIES
  ) {
    throw new StudioFeatureRolloutError(
      "invalid-dependency",
      "policy.dependencies",
      `dependencies must contain at most ${MAX_POLICY_DEPENDENCIES} feature ids`,
    );
  }
  const dependencySet = new Set<string>();
  for (const [index, dependency] of value.dependencies.entries()) {
    assertFeatureId(dependency, `policy.dependencies[${index}]`);
    if (dependency === value.featureId || dependencySet.has(dependency)) {
      throw new StudioFeatureRolloutError(
        "invalid-dependency",
        `policy.dependencies[${index}]`,
        "dependencies must be unique and cannot reference the feature itself",
      );
    }
    dependencySet.add(dependency);
  }

  return Object.freeze({
    schemaVersion: STUDIO_FEATURE_ROLLOUT_SCHEMA_VERSION,
    featureId: value.featureId,
    policyVersion: value.policyVersion,
    authority: value.authority,
    issuedAtMs: value.issuedAtMs,
    expiresAtMs,
    rolloutPercent: value.rolloutPercent,
    killSwitch: value.killSwitch,
    dependencies: Object.freeze([...dependencySet].sort()),
  });
}

export function validateStudioFeatureRolloutPolicySet(
  values: readonly unknown[],
): ReadonlyMap<string, StudioFeatureRolloutPolicy> {
  const policies = new Map<string, StudioFeatureRolloutPolicy>();
  for (const value of values) {
    const policy = normalizeStudioFeatureRolloutPolicy(value);
    if (policies.has(policy.featureId)) {
      throw new StudioFeatureRolloutError(
        "duplicate-feature",
        policy.featureId,
        `duplicate feature policy: ${policy.featureId}`,
      );
    }
    policies.set(policy.featureId, policy);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (featureId: string, path: readonly string[]): void => {
    if (visiting.has(featureId)) {
      throw new StudioFeatureRolloutError(
        "dependency-cycle",
        featureId,
        `feature dependency cycle: ${[...path, featureId].join(" -> ")}`,
      );
    }
    if (visited.has(featureId)) return;
    visiting.add(featureId);
    const policy = policies.get(featureId);
    for (const dependency of policy?.dependencies ?? []) {
      if (policies.has(dependency)) visit(dependency, [...path, featureId]);
    }
    visiting.delete(featureId);
    visited.add(featureId);
  };
  for (const featureId of policies.keys()) visit(featureId, []);
  return policies;
}

function validBucket(value: unknown): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value < STUDIO_FEATURE_ROLLOUT_BUCKET_COUNT
    ? value
    : null;
}

function readBucket(
  storage: StudioFeatureRolloutStorage,
  storageKey: string,
): number | null {
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null || !/^(?:0|[1-9]\d{0,3})$/u.test(raw)) return null;
    return validBucket(Number(raw));
  } catch {
    return null;
  }
}

function createBucket(
  storage: StudioFeatureRolloutStorage,
  random: StudioFeatureRolloutRandom,
  storageKey: string,
): number | null {
  try {
    const word = new Uint32Array(new ArrayBuffer(Uint32Array.BYTES_PER_ELEMENT));
    random.getRandomValues(word);
    const bucket = (word[0] ?? 0) % STUDIO_FEATURE_ROLLOUT_BUCKET_COUNT;
    storage.setItem(storageKey, String(bucket));
    return bucket;
  } catch {
    return null;
  }
}

export function resolveStudioFeatureCohort(
  input: ResolveStudioFeatureCohortInput,
): StudioFeatureCohortDecision {
  const percent = Number.isFinite(input.rolloutPercent)
    ? Math.min(100, Math.max(0, input.rolloutPercent))
    : 0;
  if (percent <= 0) {
    return { included: false, bucket: null, reason: "rollout-disabled" };
  }
  if (percent >= 100) {
    return { included: true, bucket: null, reason: "rollout-full" };
  }
  if (!input.storage || !input.random) {
    return { included: false, bucket: null, reason: "cohort-unavailable" };
  }
  const bucket = readBucket(input.storage, input.storageKey)
    ?? createBucket(input.storage, input.random, input.storageKey);
  if (bucket === null) {
    return { included: false, bucket: null, reason: "cohort-unavailable" };
  }
  const threshold = Math.floor(
    percent * STUDIO_FEATURE_ROLLOUT_BUCKET_COUNT / 100,
  );
  return bucket < threshold
    ? { included: true, bucket, reason: "cohort-included" }
    : { included: false, bucket, reason: "cohort-excluded" };
}

function policyStorageKey(featureId: string): string {
  return `${STUDIO_FEATURE_ROLLOUT_STORAGE_PREFIX}:lkg:${encodeURIComponent(featureId)}`;
}

export function studioFeatureRolloutBucketStorageKey(featureId: string): string {
  assertFeatureId(featureId, "featureId");
  return `${STUDIO_FEATURE_ROLLOUT_STORAGE_PREFIX}:bucket:${encodeURIComponent(featureId)}`;
}

function failureStorageKey(featureId: string): string {
  return `${STUDIO_FEATURE_ROLLOUT_STORAGE_PREFIX}:failure:${encodeURIComponent(featureId)}`;
}

function readLastKnownGood(
  storage: StudioFeatureRolloutStorage | null | undefined,
  featureId: string,
): StoredPolicyResult {
  if (!storage) return { state: "unavailable", policy: null };
  let raw: string | null;
  try {
    raw = storage.getItem(policyStorageKey(featureId));
  } catch {
    return { state: "unavailable", policy: null };
  }
  if (raw === null) return { state: "missing", policy: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || !hasExactKeys(parsed, ["schemaVersion", "policy", "checksum"])
      || parsed.schemaVersion !== STUDIO_FEATURE_ROLLOUT_SCHEMA_VERSION
      || typeof parsed.checksum !== "string"
      || !CHECKSUM_PATTERN.test(parsed.checksum)
    ) {
      return { state: "corrupt", policy: null };
    }
    const policy = normalizeStudioFeatureRolloutPolicy(parsed.policy);
    if (
      policy.featureId !== featureId
      || policy.authority !== "validated-remote"
      || checksumStudioFeatureRolloutValue(policy) !== parsed.checksum
    ) {
      return { state: "corrupt", policy: null };
    }
    return { state: "valid", policy, checksum: parsed.checksum };
  } catch {
    return { state: "corrupt", policy: null };
  }
}

function persistLastKnownGood(
  storage: StudioFeatureRolloutStorage | null | undefined,
  policy: StudioFeatureRolloutPolicy,
): string | null {
  if (!storage) return null;
  const checksum = checksumStudioFeatureRolloutValue(policy);
  const envelope: StudioFeatureRolloutLastKnownGoodEnvelope = {
    schemaVersion: STUDIO_FEATURE_ROLLOUT_SCHEMA_VERSION,
    policy,
    checksum,
  };
  try {
    storage.setItem(policyStorageKey(policy.featureId), canonicalStudioFeatureRolloutJson(envelope));
    return checksum;
  } catch {
    return null;
  }
}

function readFailureState(
  storage: StudioFeatureRolloutStorage | null | undefined,
  featureId: string,
): FailureStateResult {
  if (!storage) return { state: "unavailable", value: null };
  let raw: string | null;
  try {
    raw = storage.getItem(failureStorageKey(featureId));
  } catch {
    return { state: "unavailable", value: null };
  }
  if (raw === null) return { state: "missing", value: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || !hasExactKeys(parsed, ["state", "checksum"])
      || typeof parsed.checksum !== "string"
      || !CHECKSUM_PATTERN.test(parsed.checksum)
      || !isRecord(parsed.state)
      || !hasExactKeys(parsed.state, [
        "schemaVersion",
        "featureId",
        "policyVersion",
        "failureCount",
        "lastFailureAtMs",
        "disabledUntilMs",
      ])
      || parsed.state.schemaVersion !== STUDIO_FEATURE_ROLLOUT_SCHEMA_VERSION
      || parsed.state.featureId !== featureId
      || !validSafeInteger(parsed.state.policyVersion, 1)
      || !validSafeInteger(parsed.state.failureCount)
      || !validSafeInteger(parsed.state.lastFailureAtMs)
      || !validSafeInteger(parsed.state.disabledUntilMs)
      || checksumStudioFeatureRolloutValue(parsed.state) !== parsed.checksum
    ) {
      return { state: "corrupt", value: null };
    }
    return {
      state: "valid",
      value: parsed.state as unknown as StudioFeatureRolloutFailureState,
    };
  } catch {
    return { state: "corrupt", value: null };
  }
}

function validFailureGuard(
  value: StudioFeatureRolloutFailureGuard,
): boolean {
  return Number.isSafeInteger(value.threshold)
    && value.threshold > 0
    && Number.isSafeInteger(value.cooldownMs)
    && value.cooldownMs > 0;
}

export interface RecordStudioFeatureRolloutFailureInput {
  readonly featureId: string;
  readonly policyVersion: number;
  readonly nowMs: number;
  readonly guard: StudioFeatureRolloutFailureGuard;
  readonly storage?: StudioFeatureRolloutStorage | null;
}

export function recordStudioFeatureRolloutFailure(
  input: RecordStudioFeatureRolloutFailureInput,
): StudioFeatureRolloutFailureState | null {
  assertFeatureId(input.featureId, "featureId");
  if (
    !validSafeInteger(input.policyVersion, 1)
    || !validSafeInteger(input.nowMs)
    || !validFailureGuard(input.guard)
    || !input.storage
  ) {
    return null;
  }
  const previous = readFailureState(input.storage, input.featureId);
  const previousCount = previous.state === "valid"
    && previous.value.policyVersion === input.policyVersion
    ? previous.value.failureCount
    : 0;
  const failureCount = previousCount + 1;
  const state: StudioFeatureRolloutFailureState = {
    schemaVersion: STUDIO_FEATURE_ROLLOUT_SCHEMA_VERSION,
    featureId: input.featureId,
    policyVersion: input.policyVersion,
    failureCount,
    lastFailureAtMs: input.nowMs,
    disabledUntilMs: failureCount >= input.guard.threshold
      ? input.nowMs + input.guard.cooldownMs
      : 0,
  };
  const envelope: StudioFeatureRolloutFailureEnvelope = {
    state,
    checksum: checksumStudioFeatureRolloutValue(state),
  };
  try {
    input.storage.setItem(
      failureStorageKey(input.featureId),
      canonicalStudioFeatureRolloutJson(envelope),
    );
    return state;
  } catch {
    return null;
  }
}

export function clearStudioFeatureRolloutFailures(
  featureId: string,
  storage?: StudioFeatureRolloutStorage | null,
): boolean {
  assertFeatureId(featureId, "featureId");
  if (!storage?.removeItem) return false;
  try {
    storage.removeItem(failureStorageKey(featureId));
    return true;
  } catch {
    return false;
  }
}

function decision(
  input: ResolveStudioFeatureRolloutInput,
  partial: Omit<
    StudioFeatureRolloutDecision,
    "featureId" | "evaluatedAtMs"
  >,
): StudioFeatureRolloutDecision {
  return Object.freeze({
    featureId: input.featureId,
    evaluatedAtMs: input.nowMs,
    ...partial,
  });
}

function unavailableDecision(
  input: ResolveStudioFeatureRolloutInput,
  reason: StudioFeatureRolloutDecisionReason,
): StudioFeatureRolloutDecision {
  return decision(input, {
    enabled: false,
    reason,
    policySource: "none",
    policySelection: "none",
    policyVersion: null,
    policyChecksum: null,
    rolloutPercent: 0,
    bucket: null,
    dependencies: Object.freeze([]),
  });
}

export function resolveStudioFeatureRollout(
  input: ResolveStudioFeatureRolloutInput,
): StudioFeatureRolloutDecision {
  try {
    assertFeatureId(input.featureId, "featureId");
  } catch {
    return unavailableDecision(input, "policy-invalid");
  }
  if (!validSafeInteger(input.nowMs)) {
    return unavailableDecision(input, "policy-invalid");
  }

  let incoming: StudioFeatureRolloutPolicy | null = null;
  let incomingError:
    | "policy-unavailable"
    | "policy-invalid"
    | "policy-unvalidated" = "policy-unavailable";
  if (input.policy !== undefined && input.policy !== null) {
    try {
      incoming = normalizeStudioFeatureRolloutPolicy(input.policy);
      if (incoming.featureId !== input.featureId) {
        incoming = null;
        incomingError = "policy-invalid";
      } else if (
        incoming.authority === "validated-remote"
        && input.policyValidated !== true
      ) {
        // An unverified policy may safely turn a feature off, but it may never enable one.
        if (incoming.killSwitch) {
          return decision(input, {
            enabled: false,
            reason: "kill-switch",
            policySource: "incoming",
            policySelection: "none",
            policyVersion: incoming.policyVersion,
            policyChecksum: checksumStudioFeatureRolloutValue(incoming),
            rolloutPercent: incoming.rolloutPercent,
            bucket: null,
            dependencies: incoming.dependencies,
          });
        }
        incoming = null;
        incomingError = "policy-unvalidated";
      }
    } catch {
      incoming = null;
      incomingError = "policy-invalid";
    }
  }

  // Kill switches dominate expiry, QA overrides, cohorts, dependencies, and LKG fallback.
  if (incoming?.killSwitch) {
    return decision(input, {
      enabled: false,
      reason: "kill-switch",
      policySource: "incoming",
      policySelection: incoming.authority === "build"
        ? "incoming-build"
        : "incoming-persisted",
      policyVersion: incoming.policyVersion,
      policyChecksum: checksumStudioFeatureRolloutValue(incoming),
      rolloutPercent: incoming.rolloutPercent,
      bucket: null,
      dependencies: incoming.dependencies,
    });
  }

  const stored = readLastKnownGood(input.storage, input.featureId);
  let policy: StudioFeatureRolloutPolicy;
  let policySource: StudioFeatureRolloutPolicySource;
  let policySelection: StudioFeatureRolloutPolicySelection;
  let policyChecksum: string;

  if (incoming?.authority === "build") {
    policy = incoming;
    policySource = "incoming";
    policySelection = "incoming-build";
    policyChecksum = checksumStudioFeatureRolloutValue(incoming);
  } else if (incoming) {
    if (
      stored.state === "valid"
      && stored.policy.policyVersion > incoming.policyVersion
    ) {
      policy = stored.policy;
      policySource = "last-known-good";
      policySelection = "last-known-good-newer";
      policyChecksum = stored.checksum;
    } else if (
      stored.state === "valid"
      && stored.policy.policyVersion === incoming.policyVersion
      && stored.checksum !== checksumStudioFeatureRolloutValue(incoming)
    ) {
      return unavailableDecision(input, "policy-conflict");
    } else {
      const persistedChecksum = persistLastKnownGood(input.storage, incoming);
      if (persistedChecksum === null) {
        if (stored.state === "valid") {
          policy = stored.policy;
          policySource = "last-known-good";
          policySelection = "last-known-good-fallback";
          policyChecksum = stored.checksum;
        } else {
          return unavailableDecision(input, "policy-storage-unavailable");
        }
      } else {
        policy = incoming;
        policySource = "incoming";
        policySelection = "incoming-persisted";
        policyChecksum = persistedChecksum;
      }
    }
  } else if (stored.state === "valid") {
    policy = stored.policy;
    policySource = "last-known-good";
    policySelection = "last-known-good-fallback";
    policyChecksum = stored.checksum;
  } else if (stored.state === "corrupt") {
    return unavailableDecision(input, "last-known-good-corrupt");
  } else if (stored.state === "unavailable" && input.policy === undefined) {
    return unavailableDecision(input, "policy-storage-unavailable");
  } else {
    return unavailableDecision(input, incomingError);
  }

  if (policy.killSwitch) {
    return decision(input, {
      enabled: false,
      reason: "kill-switch",
      policySource,
      policySelection,
      policyVersion: policy.policyVersion,
      policyChecksum,
      rolloutPercent: policy.rolloutPercent,
      bucket: null,
      dependencies: policy.dependencies,
    });
  }
  if (policy.issuedAtMs > input.nowMs + MAX_CLOCK_SKEW_MS) {
    return decision(input, {
      enabled: false,
      reason: "policy-issued-in-future",
      policySource,
      policySelection,
      policyVersion: policy.policyVersion,
      policyChecksum,
      rolloutPercent: policy.rolloutPercent,
      bucket: null,
      dependencies: policy.dependencies,
    });
  }
  if (policy.expiresAtMs !== null && policy.expiresAtMs <= input.nowMs) {
    return decision(input, {
      enabled: false,
      reason: "policy-expired",
      policySource,
      policySelection,
      policyVersion: policy.policyVersion,
      policyChecksum,
      rolloutPercent: policy.rolloutPercent,
      bucket: null,
      dependencies: policy.dependencies,
    });
  }
  if (
    policy.dependencies.some(
      (featureId) => input.dependencyDecisions?.[featureId] !== true,
    )
  ) {
    return decision(input, {
      enabled: false,
      reason: "dependency-disabled",
      policySource,
      policySelection,
      policyVersion: policy.policyVersion,
      policyChecksum,
      rolloutPercent: policy.rolloutPercent,
      bucket: null,
      dependencies: policy.dependencies,
    });
  }

  if (input.failureGuard) {
    if (!validFailureGuard(input.failureGuard)) {
      return decision(input, {
        enabled: false,
        reason: "failure-state-corrupt",
        policySource,
        policySelection,
        policyVersion: policy.policyVersion,
        policyChecksum,
        rolloutPercent: policy.rolloutPercent,
        bucket: null,
        dependencies: policy.dependencies,
      });
    }
    const failure = readFailureState(input.storage, input.featureId);
    if (failure.state === "unavailable") {
      return decision(input, {
        enabled: false,
        reason: "failure-state-unavailable",
        policySource,
        policySelection,
        policyVersion: policy.policyVersion,
        policyChecksum,
        rolloutPercent: policy.rolloutPercent,
        bucket: null,
        dependencies: policy.dependencies,
      });
    }
    if (failure.state === "corrupt") {
      return decision(input, {
        enabled: false,
        reason: "failure-state-corrupt",
        policySource,
        policySelection,
        policyVersion: policy.policyVersion,
        policyChecksum,
        rolloutPercent: policy.rolloutPercent,
        bucket: null,
        dependencies: policy.dependencies,
      });
    }
    if (
      failure.state === "valid"
      && failure.value.policyVersion === policy.policyVersion
      && failure.value.failureCount >= input.failureGuard.threshold
      && failure.value.disabledUntilMs > input.nowMs
    ) {
      return decision(input, {
        enabled: false,
        reason: "failure-cooldown",
        policySource,
        policySelection,
        policyVersion: policy.policyVersion,
        policyChecksum,
        rolloutPercent: policy.rolloutPercent,
        bucket: null,
        dependencies: policy.dependencies,
      });
    }
  }

  const override = input.qaOverride === "force-on" || input.qaOverride === "force-off"
    ? input.qaOverride
    : null;
  const overrideAllowed = input.environment !== "production"
    || input.qaOverrideAuthorized === true;
  if (override !== null && overrideAllowed) {
    return decision(input, {
      enabled: override === "force-on",
      reason: override === "force-on" ? "qa-force-on" : "qa-force-off",
      policySource,
      policySelection,
      policyVersion: policy.policyVersion,
      policyChecksum,
      rolloutPercent: policy.rolloutPercent,
      bucket: null,
      dependencies: policy.dependencies,
    });
  }

  const cohort = resolveStudioFeatureCohort({
    rolloutPercent: policy.rolloutPercent,
    storageKey: typeof input.bucketStorageKey === "string"
      && input.bucketStorageKey.length > 0
      && input.bucketStorageKey.length <= 256
      ? input.bucketStorageKey
      : studioFeatureRolloutBucketStorageKey(input.featureId),
    storage: input.storage,
    random: input.random,
  });
  return decision(input, {
    enabled: cohort.included,
    reason: cohort.reason,
    policySource,
    policySelection,
    policyVersion: policy.policyVersion,
    policyChecksum,
    rolloutPercent: policy.rolloutPercent,
    bucket: cohort.bucket,
    dependencies: policy.dependencies,
  });
}
