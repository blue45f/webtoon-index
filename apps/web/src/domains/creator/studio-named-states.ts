/**
 * Photoshop Layer Comps · Figma Modes · Rive States를 웹툰 의미 단위로 통합한
 * 렌더러/React/저장소 독립 Named State 코어.
 *
 * 전체 페이지를 복제하지 않고 base state + sparse override만 저장한다. 모든 정규화와
 * 해석은 결정적이며, 손상·순환·예산 초과 문서는 fail-closed 한다.
 */

export const STUDIO_NAMED_STATE_VERSION = 1 as const;

export const STUDIO_NAMED_STATE_LIMITS = Object.freeze({
  maxStates: 128,
  maxInheritanceDepth: 24,
  maxFlatEntriesPerMap: 2_048,
  maxNestedOwners: 1_024,
  maxNestedEntries: 8_192,
  maxSerializedBytes: 512 * 1_024,
  maxIdLength: 128,
  maxNameLength: 160,
  maxCommentLength: 2_000,
  maxScalarStringLength: 1_024,
});

export type StudioNamedStateScalar = string | number | boolean;
export type StudioNamedStateNullableScalar = StudioNamedStateScalar | null;

export interface StudioNamedStatePatch {
  readonly visibility: Readonly<Record<string, boolean | null>>;
  readonly tokenModes: Readonly<Record<string, string | null>>;
  readonly variants: Readonly<
    Record<string, Readonly<Record<string, string | null>> | null>
  >;
  readonly effectParameters: Readonly<
    Record<string, Readonly<Record<string, StudioNamedStateNullableScalar>> | null>
  >;
  readonly shotParameters: Readonly<
    Record<string, Readonly<Record<string, StudioNamedStateNullableScalar>> | null>
  >;
  /**
   * `undefined`는 상속, `null`은 명시적 연결 해제, string은 데이터 세트/레시피 지정이다.
   */
  readonly textDataSetId?: string | null;
  readonly outputRecipeId?: string | null;
}

export interface StudioNamedState {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly baseStateId?: string;
  readonly comment?: string;
  readonly patch: StudioNamedStatePatch;
}

export interface StudioNamedStateDocument {
  readonly version: typeof STUDIO_NAMED_STATE_VERSION;
  readonly revision: number;
  readonly activeStateId: string | null;
  readonly states: readonly StudioNamedState[];
}

export interface StudioResolvedNamedState {
  readonly stateId: string;
  readonly stateRevision: number;
  readonly inheritanceChain: readonly string[];
  readonly visibility: Readonly<Record<string, boolean>>;
  readonly tokenModes: Readonly<Record<string, string>>;
  readonly variants: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly effectParameters: Readonly<
    Record<string, Readonly<Record<string, StudioNamedStateScalar>>>
  >;
  readonly shotParameters: Readonly<
    Record<string, Readonly<Record<string, StudioNamedStateScalar>>>
  >;
  readonly textDataSetId: string | null;
  readonly outputRecipeId: string | null;
}

export type StudioNamedStateDiffKind =
  | "visibility"
  | "token-mode"
  | "variant"
  | "effect"
  | "shot"
  | "text-data"
  | "output-recipe";

export interface StudioNamedStateDiffEntry {
  readonly kind: StudioNamedStateDiffKind;
  readonly ownerId: string | null;
  readonly property: string;
  readonly before: StudioNamedStateScalar | null;
  readonly after: StudioNamedStateScalar | null;
}

export interface StudioNamedStateApplyAvailability {
  readonly nodeIds?: ReadonlySet<string>;
  readonly tokenAxisIds?: ReadonlySet<string>;
  readonly textDataSetIds?: ReadonlySet<string>;
  readonly outputRecipeIds?: ReadonlySet<string>;
}

export type StudioNamedStateSkipReason =
  | "missing-node"
  | "missing-token-axis"
  | "missing-text-data"
  | "missing-output-recipe";

export interface StudioNamedStateSkippedChange {
  readonly change: StudioNamedStateDiffEntry;
  readonly reason: StudioNamedStateSkipReason;
}

export interface StudioNamedStateApplicationPlan {
  readonly fromStateId: string | null;
  readonly toStateId: string;
  readonly changes: readonly StudioNamedStateDiffEntry[];
  readonly skipped: readonly StudioNamedStateSkippedChange[];
  readonly applicableChanges: readonly StudioNamedStateDiffEntry[];
  readonly canApply: boolean;
}

export type StudioNamedStateErrorCode =
  | "INVALID_DOCUMENT"
  | "BUDGET_EXCEEDED"
  | "DUPLICATE_STATE"
  | "DANGLING_BASE"
  | "INHERITANCE_CYCLE"
  | "INHERITANCE_TOO_DEEP"
  | "UNKNOWN_STATE";

export class StudioNamedStateError extends Error {
  readonly code: StudioNamedStateErrorCode;

  constructor(code: StudioNamedStateErrorCode, message: string) {
    super(message);
    this.name = "StudioNamedStateError";
    this.code = code;
  }
}

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function fail(code: StudioNamedStateErrorCode, message: string): never {
  throw new StudioNamedStateError(code, message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => descriptor.get === undefined && descriptor.set === undefined,
  );
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      fail("INVALID_DOCUMENT", `${label}에 지원하지 않는 필드 ${key}가 있습니다.`);
    }
  }
}

function canonicalId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > STUDIO_NAMED_STATE_LIMITS.maxIdLength ||
    value !== value.trim() ||
    !ID_PATTERN.test(value) ||
    FORBIDDEN_KEYS.has(value)
  ) {
    fail("INVALID_DOCUMENT", `${label} ID가 올바르지 않습니다.`);
  }
  return value;
}

function canonicalText(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    hasControlCharacters(value)
  ) {
    fail("INVALID_DOCUMENT", `${label} 문자열이 올바르지 않습니다.`);
  }
  return value;
}

function canonicalRevision(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("INVALID_DOCUMENT", `${label} revision이 올바르지 않습니다.`);
  }
  return value as number;
}

function canonicalScalar(value: unknown, label: string): StudioNamedStateScalar {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (
    typeof value === "string" &&
    value.length <= STUDIO_NAMED_STATE_LIMITS.maxScalarStringLength &&
    !hasControlCharacters(value)
  ) {
    return value;
  }
  fail("INVALID_DOCUMENT", `${label} 값은 유한한 숫자·문자열·불리언이어야 합니다.`);
}

function canonicalFlatMap<Value>(
  value: unknown,
  label: string,
  normalizeValue: (candidate: unknown, path: string) => Value,
): Readonly<Record<string, Value>> {
  if (!isPlainRecord(value)) {
    fail("INVALID_DOCUMENT", `${label}은 객체여야 합니다.`);
  }
  const entries = Object.entries(value);
  if (entries.length > STUDIO_NAMED_STATE_LIMITS.maxFlatEntriesPerMap) {
    fail("BUDGET_EXCEEDED", `${label} 항목 수가 한도를 넘었습니다.`);
  }
  return Object.freeze(
    Object.fromEntries(
      entries
        .map(([key, candidate]) => {
          const id = canonicalId(key, `${label} key`);
          return [id, normalizeValue(candidate, `${label}.${id}`)] as const;
        })
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function canonicalNestedMap(
  value: unknown,
  label: string,
  normalizeValue: (
    candidate: unknown,
    path: string,
  ) => StudioNamedStateNullableScalar,
): Readonly<
  Record<string, Readonly<Record<string, StudioNamedStateNullableScalar>> | null>
> {
  if (!isPlainRecord(value)) {
    fail("INVALID_DOCUMENT", `${label}은 객체여야 합니다.`);
  }
  const owners = Object.entries(value);
  if (owners.length > STUDIO_NAMED_STATE_LIMITS.maxNestedOwners) {
    fail("BUDGET_EXCEEDED", `${label} 소유자 수가 한도를 넘었습니다.`);
  }
  let nestedEntryCount = 0;
  const normalized = owners.map(([ownerKey, ownerValue]) => {
    const ownerId = canonicalId(ownerKey, `${label} owner`);
    if (ownerValue === null) return [ownerId, null] as const;
    const properties = canonicalFlatMap(
      ownerValue,
      `${label}.${ownerId}`,
      normalizeValue,
    );
    nestedEntryCount += Object.keys(properties).length;
    if (nestedEntryCount > STUDIO_NAMED_STATE_LIMITS.maxNestedEntries) {
      fail("BUDGET_EXCEEDED", `${label} 전체 속성 수가 한도를 넘었습니다.`);
    }
    return [ownerId, properties] as const;
  });
  normalized.sort(([left], [right]) => left.localeCompare(right));
  return Object.freeze(Object.fromEntries(normalized));
}

function canonicalPatch(value: unknown): StudioNamedStatePatch {
  if (!isPlainRecord(value)) {
    fail("INVALID_DOCUMENT", "Named State patch가 올바르지 않습니다.");
  }
  assertExactKeys(
    value,
    [
      "visibility",
      "tokenModes",
      "variants",
      "effectParameters",
      "shotParameters",
      "textDataSetId",
      "outputRecipeId",
    ],
    "Named State patch",
  );
  const patch: StudioNamedStatePatch = {
    visibility: canonicalFlatMap(
      value.visibility ?? {},
      "visibility",
      (candidate, path) => {
        if (candidate === null || typeof candidate === "boolean") return candidate;
        fail("INVALID_DOCUMENT", `${path} 값은 boolean 또는 null이어야 합니다.`);
      },
    ),
    tokenModes: canonicalFlatMap(
      value.tokenModes ?? {},
      "tokenModes",
      (candidate, path) =>
        candidate === null ? null : canonicalId(candidate, path),
    ),
    variants: canonicalNestedMap(
      value.variants ?? {},
      "variants",
      (candidate, path) =>
        candidate === null ? null : canonicalId(candidate, path),
    ) as StudioNamedStatePatch["variants"],
    effectParameters: canonicalNestedMap(
      value.effectParameters ?? {},
      "effectParameters",
      (candidate, path) =>
        candidate === null ? null : canonicalScalar(candidate, path),
    ),
    shotParameters: canonicalNestedMap(
      value.shotParameters ?? {},
      "shotParameters",
      (candidate, path) =>
        candidate === null ? null : canonicalScalar(candidate, path),
    ),
    ...(Object.hasOwn(value, "textDataSetId")
      ? {
          textDataSetId:
            value.textDataSetId === null
              ? null
              : canonicalId(value.textDataSetId, "textDataSetId"),
        }
      : {}),
    ...(Object.hasOwn(value, "outputRecipeId")
      ? {
          outputRecipeId:
            value.outputRecipeId === null
              ? null
              : canonicalId(value.outputRecipeId, "outputRecipeId"),
        }
      : {}),
  };
  return Object.freeze(patch);
}

function canonicalState(value: unknown): StudioNamedState {
  if (!isPlainRecord(value)) {
    fail("INVALID_DOCUMENT", "Named State 항목이 올바르지 않습니다.");
  }
  assertExactKeys(
    value,
    ["id", "name", "revision", "baseStateId", "comment", "patch"],
    "Named State",
  );
  return Object.freeze({
    id: canonicalId(value.id, "state"),
    name: canonicalText(value.name, "state name", STUDIO_NAMED_STATE_LIMITS.maxNameLength),
    revision: canonicalRevision(value.revision, "state"),
    ...(Object.hasOwn(value, "baseStateId")
      ? { baseStateId: canonicalId(value.baseStateId, "base state") }
      : {}),
    ...(Object.hasOwn(value, "comment")
      ? {
          comment: canonicalText(
            value.comment,
            "state comment",
            STUDIO_NAMED_STATE_LIMITS.maxCommentLength,
          ),
        }
      : {}),
    patch: canonicalPatch(value.patch ?? {}),
  });
}

function validateInheritance(
  states: readonly StudioNamedState[],
  stateById: ReadonlyMap<string, StudioNamedState>,
): void {
  for (const state of states) {
    const seen = new Set<string>();
    let current: StudioNamedState | undefined = state;
    let depth = 0;
    while (current?.baseStateId) {
      if (seen.has(current.id)) {
        fail("INHERITANCE_CYCLE", `Named State ${state.id} 상속이 순환합니다.`);
      }
      seen.add(current.id);
      depth += 1;
      if (depth > STUDIO_NAMED_STATE_LIMITS.maxInheritanceDepth) {
        fail("INHERITANCE_TOO_DEEP", `Named State ${state.id} 상속 깊이가 한도를 넘었습니다.`);
      }
      const base = stateById.get(current.baseStateId);
      if (!base) {
        fail("DANGLING_BASE", `Named State ${state.id}의 원본 ${current.baseStateId}가 없습니다.`);
      }
      current = base;
    }
  }
}

export function normalizeStudioNamedStateDocument(
  value: unknown,
): StudioNamedStateDocument {
  if (!isPlainRecord(value)) {
    fail("INVALID_DOCUMENT", "Named State 문서가 객체가 아닙니다.");
  }
  assertExactKeys(value, ["version", "revision", "activeStateId", "states"], "Named State 문서");
  if (value.version !== STUDIO_NAMED_STATE_VERSION || !Array.isArray(value.states)) {
    fail("INVALID_DOCUMENT", "지원하지 않는 Named State 문서입니다.");
  }
  if (value.states.length > STUDIO_NAMED_STATE_LIMITS.maxStates) {
    fail("BUDGET_EXCEEDED", "Named State 개수가 한도를 넘었습니다.");
  }
  const states = value.states.map(canonicalState).sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const stateById = new Map<string, StudioNamedState>();
  for (const state of states) {
    if (stateById.has(state.id)) {
      fail("DUPLICATE_STATE", `Named State ${state.id}가 중복됩니다.`);
    }
    stateById.set(state.id, state);
  }
  validateInheritance(states, stateById);
  const activeStateId =
    value.activeStateId === null
      ? null
      : canonicalId(value.activeStateId, "active state");
  if (activeStateId !== null && !stateById.has(activeStateId)) {
    fail("UNKNOWN_STATE", `활성 Named State ${activeStateId}가 없습니다.`);
  }
  return Object.freeze({
    version: STUDIO_NAMED_STATE_VERSION,
    revision: canonicalRevision(value.revision, "document"),
    activeStateId,
    states: Object.freeze(states),
  });
}

export function createEmptyStudioNamedStateDocument(): StudioNamedStateDocument {
  return Object.freeze({
    version: STUDIO_NAMED_STATE_VERSION,
    revision: 0,
    activeStateId: null,
    states: Object.freeze([]),
  });
}

export function serializeStudioNamedStateDocument(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(normalizeStudioNamedStateDocument(value));
    return new TextEncoder().encode(serialized).byteLength <=
      STUDIO_NAMED_STATE_LIMITS.maxSerializedBytes
      ? serialized
      : null;
  } catch {
    return null;
  }
}

export function parseStudioNamedStateDocument(source: string): StudioNamedStateDocument | null {
  if (
    source.length === 0 ||
    new TextEncoder().encode(source).byteLength >
      STUDIO_NAMED_STATE_LIMITS.maxSerializedBytes
  ) {
    return null;
  }
  try {
    const document = normalizeStudioNamedStateDocument(JSON.parse(source));
    return JSON.stringify(document) === source ? document : null;
  } catch {
    return null;
  }
}

function applyFlatPatch<Value>(
  target: Record<string, Value>,
  patch: Readonly<Record<string, Value | null>>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete target[key];
    else target[key] = value;
  }
}

function applyNestedPatch<Value extends StudioNamedStateScalar>(
  target: Record<string, Record<string, Value>>,
  patch: Readonly<Record<string, Readonly<Record<string, Value | null>> | null>>,
): void {
  for (const [ownerId, ownerPatch] of Object.entries(patch)) {
    if (ownerPatch === null) {
      delete target[ownerId];
      continue;
    }
    const next = { ...(target[ownerId] ?? {}) };
    applyFlatPatch(next, ownerPatch);
    if (Object.keys(next).length === 0) delete target[ownerId];
    else target[ownerId] = next;
  }
}

export function resolveStudioNamedState(
  rawDocument: unknown,
  stateId: string,
): StudioResolvedNamedState {
  const document = normalizeStudioNamedStateDocument(rawDocument);
  const stateById = new Map(document.states.map((state) => [state.id, state]));
  const leaf = stateById.get(canonicalId(stateId, "state"));
  if (!leaf) fail("UNKNOWN_STATE", `Named State ${stateId}가 없습니다.`);
  const chain: StudioNamedState[] = [];
  let current: StudioNamedState | undefined = leaf;
  while (current) {
    chain.unshift(current);
    current = current.baseStateId ? stateById.get(current.baseStateId) : undefined;
  }

  const visibility: Record<string, boolean> = {};
  const tokenModes: Record<string, string> = {};
  const variants: Record<string, Record<string, string>> = {};
  const effectParameters: Record<string, Record<string, StudioNamedStateScalar>> = {};
  const shotParameters: Record<string, Record<string, StudioNamedStateScalar>> = {};
  let textDataSetId: string | null = null;
  let outputRecipeId: string | null = null;

  for (const state of chain) {
    applyFlatPatch(visibility, state.patch.visibility);
    applyFlatPatch(tokenModes, state.patch.tokenModes);
    applyNestedPatch(variants, state.patch.variants);
    applyNestedPatch(effectParameters, state.patch.effectParameters);
    applyNestedPatch(shotParameters, state.patch.shotParameters);
    if (Object.hasOwn(state.patch, "textDataSetId")) {
      textDataSetId = state.patch.textDataSetId ?? null;
    }
    if (Object.hasOwn(state.patch, "outputRecipeId")) {
      outputRecipeId = state.patch.outputRecipeId ?? null;
    }
  }

  return Object.freeze({
    stateId: leaf.id,
    stateRevision: leaf.revision,
    inheritanceChain: Object.freeze(chain.map((state) => state.id)),
    visibility: Object.freeze({ ...visibility }),
    tokenModes: Object.freeze({ ...tokenModes }),
    variants: Object.freeze(
      Object.fromEntries(
        Object.entries(variants)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, values]) => [id, Object.freeze({ ...values })]),
      ),
    ),
    effectParameters: Object.freeze(
      Object.fromEntries(
        Object.entries(effectParameters)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, values]) => [id, Object.freeze({ ...values })]),
      ),
    ),
    shotParameters: Object.freeze(
      Object.fromEntries(
        Object.entries(shotParameters)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, values]) => [id, Object.freeze({ ...values })]),
      ),
    ),
    textDataSetId,
    outputRecipeId,
  });
}

function compareFlat(
  kind: StudioNamedStateDiffKind,
  ownerId: string | null,
  before: Readonly<Record<string, StudioNamedStateScalar>>,
  after: Readonly<Record<string, StudioNamedStateScalar>>,
): StudioNamedStateDiffEntry[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.flatMap((property) => {
    const left = before[property] ?? null;
    const right = after[property] ?? null;
    return Object.is(left, right)
      ? []
      : [{ kind, ownerId, property, before: left, after: right }];
  });
}

function compareNested(
  kind: StudioNamedStateDiffKind,
  before: Readonly<Record<string, Readonly<Record<string, StudioNamedStateScalar>>>>,
  after: Readonly<Record<string, Readonly<Record<string, StudioNamedStateScalar>>>>,
): StudioNamedStateDiffEntry[] {
  const owners = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return owners.flatMap((ownerId) =>
    compareFlat(kind, ownerId, before[ownerId] ?? {}, after[ownerId] ?? {})
  );
}

export function compareStudioNamedStates(
  before: StudioResolvedNamedState | null,
  after: StudioResolvedNamedState,
): readonly StudioNamedStateDiffEntry[] {
  const changes = [
    ...compareFlat("visibility", null, before?.visibility ?? {}, after.visibility),
    ...compareFlat("token-mode", null, before?.tokenModes ?? {}, after.tokenModes),
    ...compareNested("variant", before?.variants ?? {}, after.variants),
    ...compareNested("effect", before?.effectParameters ?? {}, after.effectParameters),
    ...compareNested("shot", before?.shotParameters ?? {}, after.shotParameters),
  ];
  if ((before?.textDataSetId ?? null) !== after.textDataSetId) {
    changes.push({
      kind: "text-data",
      ownerId: null,
      property: "textDataSetId",
      before: before?.textDataSetId ?? null,
      after: after.textDataSetId,
    });
  }
  if ((before?.outputRecipeId ?? null) !== after.outputRecipeId) {
    changes.push({
      kind: "output-recipe",
      ownerId: null,
      property: "outputRecipeId",
      before: before?.outputRecipeId ?? null,
      after: after.outputRecipeId,
    });
  }
  return Object.freeze(changes);
}

function skippedReason(
  change: StudioNamedStateDiffEntry,
  availability: StudioNamedStateApplyAvailability,
): StudioNamedStateSkipReason | null {
  if (
    (change.kind === "visibility" ||
      change.kind === "variant" ||
      change.kind === "effect" ||
      change.kind === "shot") &&
    availability.nodeIds &&
    !availability.nodeIds.has(change.ownerId ?? change.property)
  ) {
    return "missing-node";
  }
  if (
    change.kind === "token-mode" &&
    availability.tokenAxisIds &&
    !availability.tokenAxisIds.has(change.property)
  ) {
    return "missing-token-axis";
  }
  if (
    change.kind === "text-data" &&
    typeof change.after === "string" &&
    availability.textDataSetIds &&
    !availability.textDataSetIds.has(change.after)
  ) {
    return "missing-text-data";
  }
  if (
    change.kind === "output-recipe" &&
    typeof change.after === "string" &&
    availability.outputRecipeIds &&
    !availability.outputRecipeIds.has(change.after)
  ) {
    return "missing-output-recipe";
  }
  return null;
}

export function planStudioNamedStateApplication(input: {
  readonly current: StudioResolvedNamedState | null;
  readonly target: StudioResolvedNamedState;
  readonly availability?: StudioNamedStateApplyAvailability;
}): StudioNamedStateApplicationPlan {
  const changes = compareStudioNamedStates(input.current, input.target);
  const availability = input.availability ?? {};
  const skipped = changes.flatMap((change) => {
    const reason = skippedReason(change, availability);
    return reason ? [{ change, reason }] : [];
  });
  const skippedSet = new Set(skipped.map(({ change }) => change));
  const applicableChanges = changes.filter((change) => !skippedSet.has(change));
  return Object.freeze({
    fromStateId: input.current?.stateId ?? null,
    toStateId: input.target.stateId,
    changes,
    skipped: Object.freeze(skipped),
    applicableChanges: Object.freeze(applicableChanges),
    canApply: skipped.length === 0,
  });
}
