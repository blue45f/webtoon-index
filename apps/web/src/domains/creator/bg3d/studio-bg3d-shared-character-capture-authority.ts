import { sha256HexPortable } from "../studio-sha256";

export const STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_SNAPSHOT_KIND =
  "toonspectrum.studio-bg3d-shared-character-capture-authority-snapshot" as const;
export const STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_LEASE_KIND =
  "toonspectrum.studio-bg3d-shared-character-capture-authority-lease" as const;
export const STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_VERSION = 1 as const;
export const STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_MAX_CHARACTERS = 12;

export type StudioBg3dSharedCharacterCaptureReadinessPhase =
  | "loading"
  | "ready"
  | "unavailable";

export type StudioBg3dSharedCharacterCaptureAuthorityCheckpoint =
  | "raster"
  | "receipt";

export interface StudioBg3dSharedCharacterCaptureIdentity {
  readonly elementId: string;
  readonly runtimeKey: string;
  readonly modelRuntimeKey: string;
  readonly placementHash: `sha256:${string}`;
  readonly sourceHash: `sha256:${string}`;
}

/**
 * Plain, freshly observed host state. `revision` is a host-owned fencing counter: the owner must
 * increase it whenever identity, membership, include policy, or runtime readiness changes.
 *
 * This module deliberately does not invent a renderer/runtime generation. That authority does not
 * currently cross the StudioBackground3D boundary. A caller that reuses an old closure or fails to
 * advance `revision` is violating the lease contract; exact payload comparison still fails closed
 * when the changed payload is supplied to verification.
 */
export interface StudioBg3dSharedCharacterCaptureAuthorityInput {
  readonly revision: number;
  readonly includeCharactersInCapture: boolean;
  readonly readinessPhase: StudioBg3dSharedCharacterCaptureReadinessPhase;
  readonly expectedCharacters: readonly StudioBg3dSharedCharacterCaptureIdentity[];
  readonly capturableElementIds: readonly string[];
  readonly previewOnlyElementIds: readonly string[];
  /** Runtime identities still loading. */
  readonly pendingElementIds: readonly string[];
  /** Runtime identities that have failed closed. */
  readonly unavailableElementIds: readonly string[];
}

export interface StudioBg3dSharedCharacterCaptureAuthoritySnapshot {
  readonly kind: typeof STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_SNAPSHOT_KIND;
  readonly version: typeof STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_VERSION;
  readonly revision: number;
  readonly includeCharactersInCapture: boolean;
  readonly readinessPhase: StudioBg3dSharedCharacterCaptureReadinessPhase;
  readonly expectedCharacters: readonly StudioBg3dSharedCharacterCaptureIdentity[];
  readonly capturableElementIds: readonly string[];
  readonly previewOnlyElementIds: readonly string[];
  readonly pendingElementIds: readonly string[];
  readonly unavailableElementIds: readonly string[];
  readonly authorityHash: `sha256:${string}`;
}

export interface StudioBg3dSharedCharacterCaptureAuthorityLease {
  readonly kind: typeof STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_LEASE_KIND;
  readonly version: typeof STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_VERSION;
  readonly revision: number;
  readonly authorityHash: `sha256:${string}`;
  /** Empty for a background-only capture, even when ready characters are visible in the editor. */
  readonly captureElementIds: readonly string[];
  readonly snapshot: StudioBg3dSharedCharacterCaptureAuthoritySnapshot;
}

export type StudioBg3dSharedCharacterCaptureAuthorityFailureCode =
  | "invalid-authority-shape"
  | "invalid-revision"
  | "invalid-character-identity"
  | "duplicate-character-identity"
  | "invalid-readiness-membership"
  | "contradictory-readiness-phase"
  | "capture-not-authoritative"
  | "invalid-lease"
  | "invalid-current-authority"
  | "invalid-checkpoint"
  | "stale-lease"
  | "revision-regressed"
  | "authority-changed-without-revision";

export interface StudioBg3dSharedCharacterCaptureAuthorityFailure {
  readonly ok: false;
  readonly code: StudioBg3dSharedCharacterCaptureAuthorityFailureCode;
}

export type StudioBg3dSharedCharacterCaptureAuthoritySnapshotResult =
  | Readonly<{
      readonly ok: true;
      readonly snapshot: StudioBg3dSharedCharacterCaptureAuthoritySnapshot;
    }>
  | StudioBg3dSharedCharacterCaptureAuthorityFailure;

export type StudioBg3dSharedCharacterCaptureAuthorityLeaseResult =
  | Readonly<{
      readonly ok: true;
      readonly lease: StudioBg3dSharedCharacterCaptureAuthorityLease;
    }>
  | StudioBg3dSharedCharacterCaptureAuthorityFailure;

export type StudioBg3dSharedCharacterCaptureAuthorityVerificationResult =
  | Readonly<{
      readonly ok: true;
      readonly checkpoint: StudioBg3dSharedCharacterCaptureAuthorityCheckpoint;
      readonly lease: StudioBg3dSharedCharacterCaptureAuthorityLease;
      readonly snapshot: StudioBg3dSharedCharacterCaptureAuthoritySnapshot;
      readonly captureElementIds: readonly string[];
    }>
  | StudioBg3dSharedCharacterCaptureAuthorityFailure;

const AUTHORITY_INPUT_KEYS = Object.freeze([
  "revision",
  "includeCharactersInCapture",
  "readinessPhase",
  "expectedCharacters",
  "capturableElementIds",
  "previewOnlyElementIds",
  "pendingElementIds",
  "unavailableElementIds",
] as const);
const IDENTITY_KEYS = Object.freeze([
  "elementId",
  "runtimeKey",
  "modelRuntimeKey",
  "placementHash",
  "sourceHash",
] as const);
const SNAPSHOT_KEYS = Object.freeze([
  "kind",
  "version",
  ...AUTHORITY_INPUT_KEYS,
  "authorityHash",
] as const);
const LEASE_KEYS = Object.freeze([
  "kind",
  "version",
  "revision",
  "authorityHash",
  "captureElementIds",
  "snapshot",
] as const);
const SAFE_ELEMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FORBIDDEN_IDS = new Set(["__proto__", "constructor", "prototype"]);
const TEXT_ENCODER = new TextEncoder();

type PlainRecord = Record<PropertyKey, unknown>;

interface NormalizedAuthority {
  readonly revision: number;
  readonly includeCharactersInCapture: boolean;
  readonly readinessPhase: StudioBg3dSharedCharacterCaptureReadinessPhase;
  readonly expectedCharacters: readonly StudioBg3dSharedCharacterCaptureIdentity[];
  readonly capturableElementIds: readonly string[];
  readonly previewOnlyElementIds: readonly string[];
  readonly pendingElementIds: readonly string[];
  readonly unavailableElementIds: readonly string[];
}

type NormalizeResult =
  | Readonly<{ readonly ok: true; readonly value: NormalizedAuthority }>
  | StudioBg3dSharedCharacterCaptureAuthorityFailure;

function failure(
  code: StudioBg3dSharedCharacterCaptureAuthorityFailureCode,
): StudioBg3dSharedCharacterCaptureAuthorityFailure {
  return Object.freeze({ ok: false as const, code });
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: PlainRecord, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every((key) => typeof key === "string" && expected.includes(key));
}

function hasCanonicalArrayShape(value: readonly unknown[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!keys.includes(String(index))) return false;
  }
  return true;
}

function safeElementId(value: unknown): value is string {
  return typeof value === "string"
    && SAFE_ELEMENT_ID_PATTERN.test(value)
    && !FORBIDDEN_IDS.has(value.toLowerCase());
}

function safeHash(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function parseIdentity(value: unknown): StudioBg3dSharedCharacterCaptureIdentity | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, IDENTITY_KEYS)) return null;
  const { elementId, runtimeKey, modelRuntimeKey, placementHash, sourceHash } = value;
  if (
    !safeElementId(elementId)
    || !safeHash(sourceHash)
    || !safeHash(placementHash)
    || runtimeKey !== `${elementId}:${sourceHash}`
    || typeof modelRuntimeKey !== "string"
    || !modelRuntimeKey.startsWith(`${elementId}:`)
    || !safeHash(modelRuntimeKey.slice(elementId.length + 1))
  ) return null;

  return Object.freeze({
    elementId,
    runtimeKey,
    modelRuntimeKey,
    placementHash,
    sourceHash,
  });
}

function parseIdArray(value: unknown): readonly string[] | null {
  if (
    !Array.isArray(value)
    || !hasCanonicalArrayShape(value)
    || value.length > STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_MAX_CHARACTERS
  ) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!safeElementId(candidate) || seen.has(candidate)) return null;
    seen.add(candidate);
    ids.push(candidate);
  }
  return Object.freeze(ids);
}

function normalizeAuthority(value: unknown): NormalizeResult {
  if (!isPlainRecord(value) || !hasExactKeys(value, AUTHORITY_INPUT_KEYS)) {
    return failure("invalid-authority-shape");
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    return failure("invalid-revision");
  }
  if (
    typeof value.includeCharactersInCapture !== "boolean"
    || (
      value.readinessPhase !== "loading"
      && value.readinessPhase !== "ready"
      && value.readinessPhase !== "unavailable"
    )
    || !Array.isArray(value.expectedCharacters)
    || !hasCanonicalArrayShape(value.expectedCharacters)
    || value.expectedCharacters.length
      > STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_MAX_CHARACTERS
  ) return failure("invalid-authority-shape");

  const expectedCharacters: StudioBg3dSharedCharacterCaptureIdentity[] = [];
  const expectedById = new Map<string, StudioBg3dSharedCharacterCaptureIdentity>();
  for (const candidate of value.expectedCharacters) {
    const identity = parseIdentity(candidate);
    if (!identity) return failure("invalid-character-identity");
    if (expectedById.has(identity.elementId)) {
      return failure("duplicate-character-identity");
    }
    expectedById.set(identity.elementId, identity);
    expectedCharacters.push(identity);
  }

  const capturable = parseIdArray(value.capturableElementIds);
  const previewOnly = parseIdArray(value.previewOnlyElementIds);
  const pending = parseIdArray(value.pendingElementIds);
  const unavailable = parseIdArray(value.unavailableElementIds);
  if (!capturable || !previewOnly || !pending || !unavailable) {
    return failure("invalid-readiness-membership");
  }

  const membershipById = new Map<string, "capturable" | "preview" | "pending" | "unavailable">();
  for (const [kind, ids] of [
    ["capturable", capturable],
    ["preview", previewOnly],
    ["pending", pending],
    ["unavailable", unavailable],
  ] as const) {
    for (const id of ids) {
      if (!expectedById.has(id) || membershipById.has(id)) {
        return failure("invalid-readiness-membership");
      }
      membershipById.set(id, kind);
    }
  }
  if (membershipById.size !== expectedCharacters.length) {
    return failure("invalid-readiness-membership");
  }

  if (
    (value.readinessPhase === "ready" && (pending.length > 0 || unavailable.length > 0))
    || (
      value.readinessPhase === "loading"
      && (pending.length === 0 || unavailable.length > 0)
    )
    || (value.readinessPhase === "unavailable" && unavailable.length === 0)
  ) return failure("contradictory-readiness-phase");

  const orderedIds = (kind: "capturable" | "preview" | "pending" | "unavailable") =>
    Object.freeze(expectedCharacters.flatMap((identity) =>
      membershipById.get(identity.elementId) === kind ? [identity.elementId] : [],
    ));

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      revision: value.revision as number,
      includeCharactersInCapture: value.includeCharactersInCapture,
      readinessPhase: value.readinessPhase,
      expectedCharacters: Object.freeze(expectedCharacters),
      capturableElementIds: orderedIds("capturable"),
      previewOnlyElementIds: orderedIds("preview"),
      pendingElementIds: orderedIds("pending"),
      unavailableElementIds: orderedIds("unavailable"),
    }),
  });
}

function snapshotPayloadJson(
  snapshot: Omit<StudioBg3dSharedCharacterCaptureAuthoritySnapshot, "authorityHash">,
): string {
  return JSON.stringify({
    kind: snapshot.kind,
    version: snapshot.version,
    revision: snapshot.revision,
    includeCharactersInCapture: snapshot.includeCharactersInCapture,
    readinessPhase: snapshot.readinessPhase,
    expectedCharacters: snapshot.expectedCharacters,
    capturableElementIds: snapshot.capturableElementIds,
    previewOnlyElementIds: snapshot.previewOnlyElementIds,
    pendingElementIds: snapshot.pendingElementIds,
    unavailableElementIds: snapshot.unavailableElementIds,
  });
}

function hashSnapshotPayload(
  snapshot: Omit<StudioBg3dSharedCharacterCaptureAuthoritySnapshot, "authorityHash">,
): `sha256:${string}` {
  return `sha256:${sha256HexPortable(TEXT_ENCODER.encode(snapshotPayloadJson(snapshot)))}`;
}

function canIssueCaptureLease(
  snapshot: StudioBg3dSharedCharacterCaptureAuthoritySnapshot,
): boolean {
  if (!snapshot.includeCharactersInCapture) return true;
  return snapshot.readinessPhase === "ready"
    && snapshot.previewOnlyElementIds.length === 0
    && snapshot.pendingElementIds.length === 0
    && snapshot.unavailableElementIds.length === 0
    && snapshot.capturableElementIds.length === snapshot.expectedCharacters.length;
}

export function snapshotStudioBg3dSharedCharacterCaptureAuthority(
  input: StudioBg3dSharedCharacterCaptureAuthorityInput | unknown,
): StudioBg3dSharedCharacterCaptureAuthoritySnapshotResult {
  const normalized = normalizeAuthority(input);
  if (!normalized.ok) return normalized;
  const payload = Object.freeze({
    kind: STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_SNAPSHOT_KIND,
    version: STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_VERSION,
    ...normalized.value,
  });
  const snapshot = Object.freeze({
    ...payload,
    authorityHash: hashSnapshotPayload(payload),
  });
  return Object.freeze({ ok: true as const, snapshot });
}

function parseSnapshot(
  value: unknown,
): StudioBg3dSharedCharacterCaptureAuthoritySnapshot | null {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, SNAPSHOT_KEYS)
    || value.kind !== STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_SNAPSHOT_KIND
    || value.version !== STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_VERSION
    || !safeHash(value.authorityHash)
  ) return null;

  const result = snapshotStudioBg3dSharedCharacterCaptureAuthority({
    revision: value.revision,
    includeCharactersInCapture: value.includeCharactersInCapture,
    readinessPhase: value.readinessPhase,
    expectedCharacters: value.expectedCharacters,
    capturableElementIds: value.capturableElementIds,
    previewOnlyElementIds: value.previewOnlyElementIds,
    pendingElementIds: value.pendingElementIds,
    unavailableElementIds: value.unavailableElementIds,
  });
  if (!result.ok || result.snapshot.authorityHash !== value.authorityHash) return null;
  return result.snapshot;
}

function createLeaseFromSnapshot(
  snapshot: StudioBg3dSharedCharacterCaptureAuthoritySnapshot,
): StudioBg3dSharedCharacterCaptureAuthorityLease {
  const captureElementIds = snapshot.includeCharactersInCapture
    ? snapshot.capturableElementIds
    : Object.freeze([]);
  return Object.freeze({
    kind: STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_LEASE_KIND,
    version: STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_VERSION,
    revision: snapshot.revision,
    authorityHash: snapshot.authorityHash,
    captureElementIds,
    snapshot,
  });
}

function parseLease(value: unknown): StudioBg3dSharedCharacterCaptureAuthorityLease | null {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, LEASE_KEYS)
    || value.kind !== STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_LEASE_KIND
    || value.version !== STUDIO_BG3D_SHARED_CHARACTER_CAPTURE_AUTHORITY_VERSION
  ) return null;
  const snapshot = parseSnapshot(value.snapshot);
  const captureElementIds = parseIdArray(value.captureElementIds);
  if (!snapshot || !captureElementIds || !canIssueCaptureLease(snapshot)) return null;
  const expectedLease = createLeaseFromSnapshot(snapshot);
  if (
    value.revision !== expectedLease.revision
    || value.authorityHash !== expectedLease.authorityHash
    || JSON.stringify(captureElementIds) !== JSON.stringify(expectedLease.captureElementIds)
  ) return null;
  return expectedLease;
}

export function acquireStudioBg3dSharedCharacterCaptureAuthorityLease(
  input: StudioBg3dSharedCharacterCaptureAuthorityInput | unknown,
): StudioBg3dSharedCharacterCaptureAuthorityLeaseResult {
  const result = snapshotStudioBg3dSharedCharacterCaptureAuthority(input);
  if (!result.ok) return result;
  if (!canIssueCaptureLease(result.snapshot)) return failure("capture-not-authoritative");
  return Object.freeze({
    ok: true as const,
    lease: createLeaseFromSnapshot(result.snapshot),
  });
}

/**
 * Re-observe the live host state and call this at both checkpoints. Passing the capture-start
 * closure back as `currentAuthority` defeats the external fencing contract and is not supported.
 */
export function verifyStudioBg3dSharedCharacterCaptureAuthorityLease(
  lease: StudioBg3dSharedCharacterCaptureAuthorityLease | unknown,
  currentAuthority: StudioBg3dSharedCharacterCaptureAuthorityInput | unknown,
  checkpoint: StudioBg3dSharedCharacterCaptureAuthorityCheckpoint,
): StudioBg3dSharedCharacterCaptureAuthorityVerificationResult {
  if (checkpoint !== "raster" && checkpoint !== "receipt") {
    return failure("invalid-checkpoint");
  }
  const parsedLease = parseLease(lease);
  if (!parsedLease) return failure("invalid-lease");
  const current = snapshotStudioBg3dSharedCharacterCaptureAuthority(currentAuthority);
  if (!current.ok) return failure("invalid-current-authority");
  if (current.snapshot.revision > parsedLease.revision) return failure("stale-lease");
  if (current.snapshot.revision < parsedLease.revision) return failure("revision-regressed");
  if (
    current.snapshot.authorityHash !== parsedLease.authorityHash
    || snapshotPayloadJson(current.snapshot) !== snapshotPayloadJson(parsedLease.snapshot)
  ) return failure("authority-changed-without-revision");
  if (!canIssueCaptureLease(current.snapshot)) return failure("capture-not-authoritative");

  return Object.freeze({
    ok: true as const,
    checkpoint,
    lease: parsedLease,
    snapshot: current.snapshot,
    captureElementIds: parsedLease.captureElementIds,
  });
}
