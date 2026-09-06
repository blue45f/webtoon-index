/**
 * Engine-neutral readiness authority for projecting a linked VRM appearance into Shared Stage.
 *
 * The coordinator deliberately knows nothing about React, Three.js, R3F, VRM nodes, or rendering.
 * Runtime adapters report exact attachment receipts and ordered frame receipts; this reducer keeps
 * the source layer authoritative until the complete current projection has crossed a later frame.
 */

export type StudioVrmLinkedAppearanceReadinessStatus = "loading" | "ready" | "unavailable";

export interface StudioVrmLinkedAppearanceReadinessIdentity {
  readonly runtimeKey: string;
  readonly placementHash: string;
  readonly projectionSignature: string;
  readonly generation: number;
}

export interface StudioVrmLinkedAppearanceExpectedWardrobe {
  readonly slot: string;
  readonly itemId: string;
}

export interface StudioVrmLinkedAppearanceExpectedProp {
  readonly uid: string;
  readonly propId: string;
}

export interface StudioVrmLinkedAppearanceReadinessExpectation {
  readonly identity: StudioVrmLinkedAppearanceReadinessIdentity;
  readonly wardrobe: readonly StudioVrmLinkedAppearanceExpectedWardrobe[];
  readonly props: readonly StudioVrmLinkedAppearanceExpectedProp[];
}

interface StudioVrmLinkedAppearanceReceiptBase {
  readonly identity: StudioVrmLinkedAppearanceReadinessIdentity;
}

export interface StudioVrmLinkedAppearanceWardrobeReceipt
  extends StudioVrmLinkedAppearanceReceiptBase {
  readonly kind: "wardrobe-attached";
  /** Zero-based render frame. Attachments and the runtime commit may share a frame. */
  readonly frame: number;
  readonly slot: string;
  readonly itemId: string;
}

export interface StudioVrmLinkedAppearancePropReceipt
  extends StudioVrmLinkedAppearanceReceiptBase {
  readonly kind: "prop-attached";
  /** Zero-based render frame. Attachments and the runtime commit may share a frame. */
  readonly frame: number;
  readonly uid: string;
  readonly propId: string;
}

export interface StudioVrmLinkedAppearanceCommitReceipt
  extends StudioVrmLinkedAppearanceReceiptBase {
  readonly kind: "runtime-commit";
  /** Zero-based render frame in which the final runtime commit ran. */
  readonly frame: number;
}

export interface StudioVrmLinkedAppearancePostCommitReceipt
  extends StudioVrmLinkedAppearanceReceiptBase {
  readonly kind: "post-commit";
  /** Must be strictly later than the runtime commit frame. */
  readonly frame: number;
}

export interface StudioVrmLinkedAppearanceFailureReceipt
  extends StudioVrmLinkedAppearanceReceiptBase {
  readonly kind: "failure";
  /** Stable runtime-owned diagnostic code. */
  readonly code: string;
  readonly detail?: string;
}

export type StudioVrmLinkedAppearanceReadinessReceipt =
  | StudioVrmLinkedAppearanceWardrobeReceipt
  | StudioVrmLinkedAppearancePropReceipt
  | StudioVrmLinkedAppearanceCommitReceipt
  | StudioVrmLinkedAppearancePostCommitReceipt
  | StudioVrmLinkedAppearanceFailureReceipt;

export type StudioVrmLinkedAppearanceProtocolFailureCode =
  | "invalid-receipt"
  | "frame-regression"
  | "unexpected-wardrobe-receipt"
  | "wardrobe-item-mismatch"
  | "duplicate-wardrobe-receipt"
  | "unexpected-prop-receipt"
  | "prop-id-mismatch"
  | "duplicate-prop-receipt"
  | "attachment-after-commit"
  | "missing-attachments-before-commit"
  | "duplicate-commit-receipt"
  | "post-commit-before-commit"
  | "post-commit-frame-not-after-commit"
  | "duplicate-post-commit-receipt"
  | "receipt-after-post-commit";

export type StudioVrmLinkedAppearanceReadinessFailure =
  | Readonly<{
      kind: "protocol";
      code: StudioVrmLinkedAppearanceProtocolFailureCode;
      receiptKind: string;
    }>
  | Readonly<{
      kind: "runtime";
      code: string;
      detail: string | null;
    }>;

export interface StudioVrmLinkedAppearanceReadinessState {
  readonly kind: "studio-vrm-linked-appearance-readiness";
  readonly identity: StudioVrmLinkedAppearanceReadinessIdentity;
  readonly expectedWardrobe: readonly StudioVrmLinkedAppearanceExpectedWardrobe[];
  readonly expectedProps: readonly StudioVrmLinkedAppearanceExpectedProp[];
  readonly receivedWardrobe: readonly StudioVrmLinkedAppearanceExpectedWardrobe[];
  readonly receivedProps: readonly StudioVrmLinkedAppearanceExpectedProp[];
  readonly lastAcceptedFrame: number | null;
  readonly commitFrame: number | null;
  readonly postCommitFrame: number | null;
  readonly failure: StudioVrmLinkedAppearanceReadinessFailure | null;
}

export interface StudioVrmLinkedAppearanceReadinessSnapshot {
  readonly kind: "studio-vrm-linked-appearance-readiness-snapshot";
  readonly status: StudioVrmLinkedAppearanceReadinessStatus;
  readonly identity: StudioVrmLinkedAppearanceReadinessIdentity;
  readonly expected: Readonly<{
    wardrobe: readonly StudioVrmLinkedAppearanceExpectedWardrobe[];
    props: readonly StudioVrmLinkedAppearanceExpectedProp[];
  }>;
  readonly received: Readonly<{
    wardrobe: readonly StudioVrmLinkedAppearanceExpectedWardrobe[];
    props: readonly StudioVrmLinkedAppearanceExpectedProp[];
  }>;
  readonly missing: Readonly<{
    wardrobe: readonly StudioVrmLinkedAppearanceExpectedWardrobe[];
    props: readonly StudioVrmLinkedAppearanceExpectedProp[];
  }>;
  readonly attachmentsComplete: boolean;
  readonly commitFrame: number | null;
  readonly postCommitFrame: number | null;
  readonly failure: StudioVrmLinkedAppearanceReadinessFailure | null;
}

export type StudioVrmLinkedAppearanceReadinessTransitionDisposition =
  | "accepted"
  | "failed"
  | "ignored";

export type StudioVrmLinkedAppearanceReadinessIgnoredReason =
  | "identity-mismatch"
  | "invalid-receipt"
  | "terminal-unavailable";

export interface StudioVrmLinkedAppearanceReadinessTransition {
  readonly disposition: StudioVrmLinkedAppearanceReadinessTransitionDisposition;
  readonly reason:
    | StudioVrmLinkedAppearanceProtocolFailureCode
    | StudioVrmLinkedAppearanceReadinessIgnoredReason
    | "runtime-failure"
    | null;
  readonly state: StudioVrmLinkedAppearanceReadinessState;
  readonly snapshot: StudioVrmLinkedAppearanceReadinessSnapshot;
}

const IDENTITY_KEYS = [
  "runtimeKey",
  "placementHash",
  "projectionSignature",
  "generation",
] as const;

const RECEIPT_KEYS = {
  "wardrobe-attached": ["kind", "identity", "frame", "slot", "itemId"],
  "prop-attached": ["kind", "identity", "frame", "uid", "propId"],
  "runtime-commit": ["kind", "identity", "frame"],
  "post-commit": ["kind", "identity", "frame"],
  failure: ["kind", "identity", "code"],
} as const;

const MAX_DIAGNOSTIC_CODE_LENGTH = 128;
const MAX_DIAGNOSTIC_DETAIL_LENGTH = 1_024;
const MAX_RECEIPT_KIND_LENGTH = 64;
const moduleCreatedStates = new WeakSet<object>();

function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return value;
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  for (const key of Reflect.ownKeys(objectValue)) {
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  if (!Object.isFrozen(objectValue)) Object.freeze(objectValue);
  return value;
}

function ownDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) => typeof key !== "string" || !allowedKeys.has(key))
      || requiredKeys.some((key) => !ownKeys.includes(key))
    ) {
      return null;
    }

    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of ownKeys) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function ownDataValue(value: unknown, key: string): unknown {
  try {
    if (value === null || typeof value !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeBoundedDiagnostic(value: string, maximumLength: number): string {
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const nextCharacter = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      ? " "
      : character;
    if (sanitized.length + nextCharacter.length > maximumLength) break;
    sanitized += nextCharacter;
  }
  return sanitized.trim();
}

function canonicalReceiptKind(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  return sanitizeBoundedDiagnostic(value, MAX_RECEIPT_KIND_LENGTH) || "unknown";
}

function identityClaimMatches(
  receipt: unknown,
  expected: StudioVrmLinkedAppearanceReadinessIdentity,
): boolean {
  const candidate = ownDataValue(receipt, "identity");
  if (candidate === null || typeof candidate !== "object") return false;
  return ownDataValue(candidate, "runtimeKey") === expected.runtimeKey
    && ownDataValue(candidate, "placementHash") === expected.placementHash
    && ownDataValue(candidate, "projectionSignature") === expected.projectionSignature
    && ownDataValue(candidate, "generation") === expected.generation;
}

function exactIdentityMatches(
  candidate: unknown,
  expected: StudioVrmLinkedAppearanceReadinessIdentity,
): boolean {
  const identity = ownDataRecord(candidate, IDENTITY_KEYS);
  return identity !== null
    && identity.runtimeKey === expected.runtimeKey
    && identity.placementHash === expected.placementHash
    && identity.projectionSignature === expected.projectionSignature
    && identity.generation === expected.generation;
}

function assertModuleCreatedState(
  state: unknown,
): asserts state is StudioVrmLinkedAppearanceReadinessState {
  if (
    (typeof state !== "object" && typeof state !== "function")
    || state === null
    || !moduleCreatedStates.has(state as object)
  ) {
    throw new TypeError(
      "Linked appearance readiness only accepts a state created by this coordinator module."
    );
  }
}

function validRequiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validFrame(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareWardrobe(
  left: StudioVrmLinkedAppearanceExpectedWardrobe,
  right: StudioVrmLinkedAppearanceExpectedWardrobe
): number {
  return compareStrings(left.slot, right.slot) || compareStrings(left.itemId, right.itemId);
}

function compareProps(
  left: StudioVrmLinkedAppearanceExpectedProp,
  right: StudioVrmLinkedAppearanceExpectedProp
): number {
  return compareStrings(left.uid, right.uid) || compareStrings(left.propId, right.propId);
}

function assertIdentity(
  identity: StudioVrmLinkedAppearanceReadinessIdentity
): StudioVrmLinkedAppearanceReadinessIdentity {
  const record = ownDataRecord(identity, IDENTITY_KEYS);
  if (
    !record
    || !validRequiredString(record.runtimeKey)
    || !validRequiredString(record.placementHash)
    || !validRequiredString(record.projectionSignature)
    || !validGeneration(record.generation)
  ) {
    throw new TypeError(
      "Linked appearance readiness requires non-empty runtime, placement, and projection identities plus a positive safe-integer generation."
    );
  }
  return deepFreeze({
    runtimeKey: record.runtimeKey,
    placementHash: record.placementHash,
    projectionSignature: record.projectionSignature,
    generation: record.generation,
  });
}

function canonicalWardrobe(
  wardrobe: readonly StudioVrmLinkedAppearanceExpectedWardrobe[]
): readonly StudioVrmLinkedAppearanceExpectedWardrobe[] {
  if (!Array.isArray(wardrobe)) {
    throw new TypeError("Linked appearance readiness wardrobe expectations must be an array.");
  }
  const slots = new Set<string>();
  const canonical = wardrobe.map((entry) => {
    if (!entry || !validRequiredString(entry.slot) || !validRequiredString(entry.itemId)) {
      throw new TypeError("Every wardrobe expectation requires a non-empty slot and itemId.");
    }
    if (slots.has(entry.slot)) {
      throw new TypeError(`Duplicate wardrobe expectation for slot: ${entry.slot}`);
    }
    slots.add(entry.slot);
    return { slot: entry.slot, itemId: entry.itemId };
  });
  canonical.sort(compareWardrobe);
  return deepFreeze(canonical);
}

function canonicalProps(
  props: readonly StudioVrmLinkedAppearanceExpectedProp[]
): readonly StudioVrmLinkedAppearanceExpectedProp[] {
  if (!Array.isArray(props)) {
    throw new TypeError("Linked appearance readiness prop expectations must be an array.");
  }
  const uids = new Set<string>();
  const canonical = props.map((entry) => {
    if (!entry || !validRequiredString(entry.uid) || !validRequiredString(entry.propId)) {
      throw new TypeError("Every prop expectation requires a non-empty uid and propId.");
    }
    if (uids.has(entry.uid)) {
      throw new TypeError(`Duplicate prop expectation for uid: ${entry.uid}`);
    }
    uids.add(entry.uid);
    return { uid: entry.uid, propId: entry.propId };
  });
  canonical.sort(compareProps);
  return deepFreeze(canonical);
}

function frozenState(
  state: StudioVrmLinkedAppearanceReadinessState
): StudioVrmLinkedAppearanceReadinessState {
  const frozen = deepFreeze(state);
  moduleCreatedStates.add(frozen);
  return frozen;
}

export function createStudioVrmLinkedAppearanceReadiness(
  expectation: StudioVrmLinkedAppearanceReadinessExpectation
): StudioVrmLinkedAppearanceReadinessState {
  if (!expectation) {
    throw new TypeError("Linked appearance readiness requires an expectation.");
  }
  return frozenState({
    kind: "studio-vrm-linked-appearance-readiness",
    identity: assertIdentity(expectation.identity),
    expectedWardrobe: canonicalWardrobe(expectation.wardrobe),
    expectedProps: canonicalProps(expectation.props),
    receivedWardrobe: deepFreeze([]),
    receivedProps: deepFreeze([]),
    lastAcceptedFrame: null,
    commitFrame: null,
    postCommitFrame: null,
    failure: null,
  });
}

function missingWardrobe(
  state: StudioVrmLinkedAppearanceReadinessState
): readonly StudioVrmLinkedAppearanceExpectedWardrobe[] {
  return state.expectedWardrobe.filter(
    (expected) => !state.receivedWardrobe.some((receipt) => receipt.slot === expected.slot)
  );
}

function missingProps(
  state: StudioVrmLinkedAppearanceReadinessState
): readonly StudioVrmLinkedAppearanceExpectedProp[] {
  return state.expectedProps.filter(
    (expected) => !state.receivedProps.some((receipt) => receipt.uid === expected.uid)
  );
}

export function snapshotStudioVrmLinkedAppearanceReadiness(
  state: StudioVrmLinkedAppearanceReadinessState
): StudioVrmLinkedAppearanceReadinessSnapshot {
  assertModuleCreatedState(state);
  const wardrobe = missingWardrobe(state);
  const props = missingProps(state);
  const attachmentsComplete = wardrobe.length === 0 && props.length === 0;
  const status: StudioVrmLinkedAppearanceReadinessStatus = state.failure
    ? "unavailable"
    : attachmentsComplete && state.commitFrame !== null && state.postCommitFrame !== null
      ? "ready"
      : "loading";

  return deepFreeze({
    kind: "studio-vrm-linked-appearance-readiness-snapshot",
    status,
    identity: state.identity,
    expected: {
      wardrobe: state.expectedWardrobe,
      props: state.expectedProps,
    },
    received: {
      wardrobe: state.receivedWardrobe,
      props: state.receivedProps,
    },
    missing: { wardrobe, props },
    attachmentsComplete,
    commitFrame: state.commitFrame,
    postCommitFrame: state.postCommitFrame,
    failure: state.failure,
  });
}

function transition(
  disposition: StudioVrmLinkedAppearanceReadinessTransitionDisposition,
  reason: StudioVrmLinkedAppearanceReadinessTransition["reason"],
  state: StudioVrmLinkedAppearanceReadinessState
): StudioVrmLinkedAppearanceReadinessTransition {
  return deepFreeze({
    disposition,
    reason,
    state,
    snapshot: snapshotStudioVrmLinkedAppearanceReadiness(state),
  });
}

function protocolFailure(
  state: StudioVrmLinkedAppearanceReadinessState,
  code: StudioVrmLinkedAppearanceProtocolFailureCode,
  receiptKind: string
): StudioVrmLinkedAppearanceReadinessTransition {
  const next = frozenState({
    ...state,
    failure: deepFreeze({ kind: "protocol", code, receiptKind }),
  });
  return transition("failed", code, next);
}

function accepted(
  state: StudioVrmLinkedAppearanceReadinessState
): StudioVrmLinkedAppearanceReadinessTransition {
  return transition("accepted", null, state);
}

function appendWardrobe(
  state: StudioVrmLinkedAppearanceReadinessState,
  receipt: StudioVrmLinkedAppearanceWardrobeReceipt
): StudioVrmLinkedAppearanceReadinessTransition {
  if (state.commitFrame !== null) {
    return protocolFailure(state, "attachment-after-commit", receipt.kind);
  }
  const expected = state.expectedWardrobe.find((entry) => entry.slot === receipt.slot);
  if (!expected) return protocolFailure(state, "unexpected-wardrobe-receipt", receipt.kind);
  if (expected.itemId !== receipt.itemId) {
    return protocolFailure(state, "wardrobe-item-mismatch", receipt.kind);
  }
  if (state.receivedWardrobe.some((entry) => entry.slot === receipt.slot)) {
    return protocolFailure(state, "duplicate-wardrobe-receipt", receipt.kind);
  }
  if (state.lastAcceptedFrame !== null && receipt.frame < state.lastAcceptedFrame) {
    return protocolFailure(state, "frame-regression", receipt.kind);
  }
  const receivedWardrobe = [...state.receivedWardrobe, {
    slot: receipt.slot,
    itemId: receipt.itemId,
  }].sort(compareWardrobe);
  return accepted(frozenState({
    ...state,
    receivedWardrobe: deepFreeze(receivedWardrobe),
    lastAcceptedFrame: receipt.frame,
  }));
}

function appendProp(
  state: StudioVrmLinkedAppearanceReadinessState,
  receipt: StudioVrmLinkedAppearancePropReceipt
): StudioVrmLinkedAppearanceReadinessTransition {
  if (state.commitFrame !== null) {
    return protocolFailure(state, "attachment-after-commit", receipt.kind);
  }
  const expected = state.expectedProps.find((entry) => entry.uid === receipt.uid);
  if (!expected) return protocolFailure(state, "unexpected-prop-receipt", receipt.kind);
  if (expected.propId !== receipt.propId) {
    return protocolFailure(state, "prop-id-mismatch", receipt.kind);
  }
  if (state.receivedProps.some((entry) => entry.uid === receipt.uid)) {
    return protocolFailure(state, "duplicate-prop-receipt", receipt.kind);
  }
  if (state.lastAcceptedFrame !== null && receipt.frame < state.lastAcceptedFrame) {
    return protocolFailure(state, "frame-regression", receipt.kind);
  }
  const receivedProps = [...state.receivedProps, {
    uid: receipt.uid,
    propId: receipt.propId,
  }].sort(compareProps);
  return accepted(frozenState({
    ...state,
    receivedProps: deepFreeze(receivedProps),
    lastAcceptedFrame: receipt.frame,
  }));
}

function commit(
  state: StudioVrmLinkedAppearanceReadinessState,
  receipt: StudioVrmLinkedAppearanceCommitReceipt
): StudioVrmLinkedAppearanceReadinessTransition {
  if (state.postCommitFrame !== null) {
    return protocolFailure(state, "receipt-after-post-commit", receipt.kind);
  }
  if (state.commitFrame !== null) {
    return protocolFailure(state, "duplicate-commit-receipt", receipt.kind);
  }
  if (state.lastAcceptedFrame !== null && receipt.frame < state.lastAcceptedFrame) {
    return protocolFailure(state, "frame-regression", receipt.kind);
  }
  if (missingWardrobe(state).length > 0 || missingProps(state).length > 0) {
    return protocolFailure(state, "missing-attachments-before-commit", receipt.kind);
  }
  return accepted(frozenState({
    ...state,
    commitFrame: receipt.frame,
    lastAcceptedFrame: receipt.frame,
  }));
}

function postCommit(
  state: StudioVrmLinkedAppearanceReadinessState,
  receipt: StudioVrmLinkedAppearancePostCommitReceipt
): StudioVrmLinkedAppearanceReadinessTransition {
  if (state.postCommitFrame !== null) {
    return protocolFailure(state, "duplicate-post-commit-receipt", receipt.kind);
  }
  if (state.commitFrame === null) {
    return protocolFailure(state, "post-commit-before-commit", receipt.kind);
  }
  if (receipt.frame <= state.commitFrame) {
    return protocolFailure(state, "post-commit-frame-not-after-commit", receipt.kind);
  }
  return accepted(frozenState({
    ...state,
    postCommitFrame: receipt.frame,
    lastAcceptedFrame: receipt.frame,
  }));
}

function explicitFailure(
  state: StudioVrmLinkedAppearanceReadinessState,
  codeValue: unknown,
  detailValue: unknown,
): StudioVrmLinkedAppearanceReadinessTransition {
  if (typeof codeValue !== "string"
      || (detailValue !== undefined && typeof detailValue !== "string")) {
    return protocolFailure(state, "invalid-receipt", "failure");
  }
  const code = sanitizeBoundedDiagnostic(codeValue, MAX_DIAGNOSTIC_CODE_LENGTH);
  if (!validRequiredString(code)) {
    return protocolFailure(state, "invalid-receipt", "failure");
  }
  const detail = typeof detailValue === "string"
    ? sanitizeBoundedDiagnostic(detailValue, MAX_DIAGNOSTIC_DETAIL_LENGTH) || null
    : null;
  const next = frozenState({
    ...state,
    failure: deepFreeze({
      kind: "runtime",
      code,
      detail,
    }),
  });
  return transition("failed", "runtime-failure", next);
}

function exactReceiptRecord(
  receipt: unknown,
  requiredKeys: readonly string[],
  identity: StudioVrmLinkedAppearanceReadinessIdentity,
  optionalKeys: readonly string[] = [],
): Record<string, unknown> | null {
  const record = ownDataRecord(receipt, requiredKeys, optionalKeys);
  return record && exactIdentityMatches(record.identity, identity) ? record : null;
}

/**
 * Applies one receipt to the exact current projection generation.
 *
 * Identity mismatches are ignored so a late callback cannot poison a newer generation. Any
 * malformed or out-of-order receipt that claims the current identity fails the generation closed.
 */
export function applyStudioVrmLinkedAppearanceReadinessReceipt(
  state: StudioVrmLinkedAppearanceReadinessState,
  receipt: StudioVrmLinkedAppearanceReadinessReceipt
): StudioVrmLinkedAppearanceReadinessTransition {
  assertModuleCreatedState(state);
  if (!receipt || typeof receipt !== "object") {
    return transition("ignored", "invalid-receipt", state);
  }
  if (!identityClaimMatches(receipt, state.identity)) {
    return transition("ignored", "identity-mismatch", state);
  }
  if (state.failure) return transition("ignored", "terminal-unavailable", state);

  const kindValue = ownDataValue(receipt, "kind");
  const receiptKind = canonicalReceiptKind(kindValue);

  if (kindValue === "failure") {
    const record = exactReceiptRecord(
      receipt,
      RECEIPT_KEYS.failure,
      state.identity,
      ["detail"],
    );
    if (!record) return protocolFailure(state, "invalid-receipt", receiptKind);
    return explicitFailure(state, record.code, record.detail);
  }

  if (kindValue === "wardrobe-attached") {
    const record = exactReceiptRecord(
      receipt,
      RECEIPT_KEYS["wardrobe-attached"],
      state.identity,
    );
    if (
      !record
      || !validFrame(record.frame)
      || !validRequiredString(record.slot)
      || !validRequiredString(record.itemId)
    ) {
      return protocolFailure(state, "invalid-receipt", receiptKind);
    }
    return appendWardrobe(state, {
      kind: "wardrobe-attached",
      identity: state.identity,
      frame: record.frame,
      slot: record.slot,
      itemId: record.itemId,
    });
  }

  if (kindValue === "prop-attached") {
    const record = exactReceiptRecord(
      receipt,
      RECEIPT_KEYS["prop-attached"],
      state.identity,
    );
    if (
      !record
      || !validFrame(record.frame)
      || !validRequiredString(record.uid)
      || !validRequiredString(record.propId)
    ) {
      return protocolFailure(state, "invalid-receipt", receiptKind);
    }
    return appendProp(state, {
      kind: "prop-attached",
      identity: state.identity,
      frame: record.frame,
      uid: record.uid,
      propId: record.propId,
    });
  }

  if (kindValue === "runtime-commit") {
    const record = exactReceiptRecord(
      receipt,
      RECEIPT_KEYS["runtime-commit"],
      state.identity,
    );
    if (!record || !validFrame(record.frame)) {
      return protocolFailure(state, "invalid-receipt", receiptKind);
    }
    return commit(state, {
      kind: "runtime-commit",
      identity: state.identity,
      frame: record.frame,
    });
  }

  if (kindValue === "post-commit") {
    const record = exactReceiptRecord(
      receipt,
      RECEIPT_KEYS["post-commit"],
      state.identity,
    );
    if (!record || !validFrame(record.frame)) {
      return protocolFailure(state, "invalid-receipt", receiptKind);
    }
    return postCommit(state, {
      kind: "post-commit",
      identity: state.identity,
      frame: record.frame,
    });
  }

  return protocolFailure(state, "invalid-receipt", receiptKind);
}
