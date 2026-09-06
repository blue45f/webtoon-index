/**
 * Pure document plan for "컷 레이어 분리".
 *
 * Studio elements are stored BACK -> FRONT. The first slice deliberately supports only one
 * visible, unlocked, ungrouped static ImageEl. A successful plan replaces that image in place
 * with a contiguous backup/background/foreground group; every failure is an atomic no-op.
 */

import {
  createLayerGroup,
  hasContiguousLayerGroups,
  type LayerGroup,
} from "../studio-layers";

import type { El, ImageEl } from "../studio-element-model";

export const STUDIO_LAYER_LIFT_DEFAULT_GROUP_NAME = "컷 레이어 분리";
export const STUDIO_LAYER_LIFT_OUTPUT_BASIS =
  "flattened-source-appearance" as const;
export const STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE = "local-unsaved" as const;

export const STUDIO_LAYER_LIFT_MEMBER_NAMES = Object.freeze({
  original: "원본 백업",
  background: "분리 배경",
  foreground: "분리 전경",
});

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_BASE64_SIGNATURE_PREFIX = "iVBORw0KGgo";
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const MAX_PNG_DATA_URL_LENGTH = Math.ceil(MAX_PNG_BYTES / 3) * 4
  + PNG_DATA_URL_PREFIX.length;
const MAX_ID_LENGTH = 160;
const MAX_GROUP_NAME_LENGTH = 120;
const SOURCE_FINGERPRINT_PREFIX = "studio-layer-lift-source-v1";
const BACK_TO_FRONT_ROLES = ["original", "background", "foreground"] as const;

export type StudioLayerLiftMemberRole = (typeof BACK_TO_FRONT_ROLES)[number];

export interface PlanStudioLayerLiftInput {
  readonly elements: readonly El[];
  readonly groups: readonly LayerGroup[];
  readonly sourceId: string;
  readonly groupId: string;
  readonly backgroundId: string;
  readonly foregroundId: string;
  /**
   * The provider must render the source's current appearance before segmentation. Generated
   * layers are intentionally plain images so filters, masks, clipping and blend modes are not
   * applied twice after decomposition.
   */
  readonly outputBasis: typeof STUDIO_LAYER_LIFT_OUTPUT_BASIS;
  /**
   * Raw PNG data URLs are not durable CRDT assets. This first slice is gated to an unsaved
   * local document until batch work-asset admission can supply ID-bound references.
   */
  readonly persistenceScope: typeof STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE;
  readonly backgroundPngDataUrl: string;
  readonly foregroundPngDataUrl: string;
  readonly groupName?: string;
  /** Optional segmentation-model confidence in the inclusive range 0..1. */
  readonly confidence?: number;
}

export type StudioLayerLiftPlanErrorCode =
  | "duplicate-id"
  | "invalid-confidence"
  | "invalid-group-name"
  | "invalid-id"
  | "invalid-output"
  | "invalid-output-basis"
  | "invalid-persistence-scope"
  | "noncontiguous-groups"
  | "source-already-grouped"
  | "source-hidden"
  | "source-locked"
  | "source-missing"
  | "source-not-image"
  | "source-not-static"
  | "source-clipping-dependent"
  | "source-unfingerprintable";

export interface StudioLayerLiftPlanDiagnostics {
  readonly sourceIndex: number;
  readonly confidence: number | null;
  readonly memberOrder: readonly StudioLayerLiftMemberRole[];
  readonly outputByteLengths: Readonly<{
    background: number;
    foreground: number;
  }>;
}

export interface StudioLayerLiftPlanSuccess {
  readonly ok: true;
  readonly sourceId: string;
  readonly sourceFingerprint: string;
  readonly newGroup: LayerGroup;
  readonly nextElements: El[];
  readonly nextGroups: LayerGroup[];
  /** The new foreground is the only layer selected after the atomic commit. */
  readonly selectedId: string;
  readonly diagnostics: StudioLayerLiftPlanDiagnostics;
}

export interface StudioLayerLiftPlanFailure {
  readonly ok: false;
  readonly code: StudioLayerLiftPlanErrorCode;
  readonly message: string;
  /** Exact input references, so a rejected plan is a verifiable document no-op. */
  readonly nextElements: readonly El[];
  readonly nextGroups: readonly LayerGroup[];
}

export type StudioLayerLiftPlanResult =
  | StudioLayerLiftPlanSuccess
  | StudioLayerLiftPlanFailure;

export interface StudioLayerLiftSourceState {
  readonly elements: readonly El[];
  readonly groups: readonly LayerGroup[];
  readonly sourceId: string;
}

type StudioLayerLiftSource = ImageEl & El;

interface SourceInspection {
  readonly source: StudioLayerLiftSource;
  readonly sourceIndex: number;
}

interface SourceInspectionFailure {
  readonly code: StudioLayerLiftPlanErrorCode;
  readonly message: string;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || (codePoint >= 127 && codePoint <= 159);
  });
}

function isValidId(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= MAX_ID_LENGTH
    && value.trim() === value
    && !hasControlCharacter(value)
  );
}

function validGroupName(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= MAX_GROUP_NAME_LENGTH
    && value.trim() === value
    && !hasControlCharacter(value)
  );
}

function pngDataUrlByteLength(value: unknown): number | null {
  if (
    typeof value !== "string"
    || value.length > MAX_PNG_DATA_URL_LENGTH
    || !value.startsWith(PNG_DATA_URL_PREFIX)
  ) {
    return null;
  }
  const payload = value.slice(PNG_DATA_URL_PREFIX.length);
  if (
    payload.length === 0
    || payload.length % 4 !== 0
    || !payload.startsWith(PNG_BASE64_SIGNATURE_PREFIX)
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(payload)
  ) {
    return null;
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const bytes = payload.length / 4 * 3 - padding;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

function imageOutputFromFlattenedSource(
  source: StudioLayerLiftSource,
  input: {
    readonly id: string;
    readonly name: string;
    readonly src: string;
    readonly groupId: string;
  },
): StudioLayerLiftSource {
  return {
    id: input.id,
    type: "image",
    name: input.name,
    src: input.src,
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    rotation: source.rotation,
    ...(source.flipped === undefined ? {} : { flipped: source.flipped }),
    ...(source.flippedY === undefined ? {} : { flippedY: source.flippedY }),
    ...(source.skewX === undefined ? {} : { skewX: source.skewX }),
    ...(source.skewY === undefined ? {} : { skewY: source.skewY }),
    ...(source.lockAspect === undefined ? {} : { lockAspect: source.lockAspect }),
    ...(source.noClip === undefined ? {} : { noClip: source.noClip }),
    ...(source.stockImageCredit === undefined
      ? {}
      : { stockImageCredit: source.stockImageCredit }),
    ...(source.communityAssetCredit === undefined
      ? {}
      : { communityAssetCredit: source.communityAssetCredit }),
    ...(source.aiProvenance === undefined ? {} : { aiProvenance: source.aiProvenance }),
    groupId: input.groupId,
    hidden: false,
    locked: false,
  };
}

function isStaticImage(source: StudioLayerLiftSource): boolean {
  if (
    source.frames !== undefined
    || source.frameFps !== undefined
    || source.frameLoop !== undefined
    || source.activeFrameId !== undefined
    || source.isAnimatedGif === true
    || source.bg3dScene !== undefined
    || source.vrmScene !== undefined
    || source.bg3dLtBundleId !== undefined
    || source.bg3dLtRole !== undefined
    || source.bg3dLtRenderMode !== undefined
  ) {
    return false;
  }
  const normalizedSrc = source.src.trim().toLowerCase();
  return (
    !normalizedSrc.startsWith("data:image/gif")
    && !/\.gif(?:$|[?#])/u.test(normalizedSrc)
  );
}

function duplicateDocumentId(
  elements: readonly El[],
  groups: readonly LayerGroup[],
): boolean {
  const ids = new Set<string>();
  for (const entry of [...elements, ...groups]) {
    if (ids.has(entry.id)) return true;
    ids.add(entry.id);
  }
  return false;
}

function inspectSource(state: StudioLayerLiftSourceState): SourceInspection | SourceInspectionFailure {
  if (duplicateDocumentId(state.elements, state.groups)) {
    return {
      code: "duplicate-id",
      message: "문서에 중복된 레이어 또는 그룹 ID가 있어 분리를 중단했습니다.",
    };
  }
  if (!hasContiguousLayerGroups(state.elements)) {
    return {
      code: "noncontiguous-groups",
      message: "기존 레이어 그룹이 연속하지 않아 분리를 중단했습니다.",
    };
  }
  const sourceIndex = state.elements.findIndex((element) => element.id === state.sourceId);
  if (sourceIndex < 0) {
    return {
      code: "source-missing",
      message: "분리할 원본 레이어를 찾을 수 없습니다.",
    };
  }
  const element = state.elements[sourceIndex]!;
  if (element.type !== "image") {
    return {
      code: "source-not-image",
      message: "첫 버전에서는 정적 이미지 레이어만 분리할 수 있습니다.",
    };
  }
  const source = element as StudioLayerLiftSource;
  if (source.groupId !== undefined) {
    return {
      code: "source-already-grouped",
      message: "이미 그룹에 속한 레이어는 분리할 수 없습니다.",
    };
  }
  if (source.hidden === true) {
    return {
      code: "source-hidden",
      message: "숨긴 레이어는 표시한 뒤 분리해 주세요.",
    };
  }
  if (source.locked === true) {
    return {
      code: "source-locked",
      message: "잠긴 레이어는 잠금을 해제한 뒤 분리해 주세요.",
    };
  }
  if (!isStaticImage(source)) {
    return {
      code: "source-not-static",
      message: "애니메이션 이미지 레이어는 현재 분리할 수 없습니다.",
    };
  }
  const frontNeighbor = state.elements[sourceIndex + 1];
  if (source.clipBelow === true || frontNeighbor?.clipBelow === true) {
    return {
      code: "source-clipping-dependent",
      message: "클리핑 관계가 있는 이미지는 레이어를 평탄화한 뒤 분리해 주세요.",
    };
  }
  return { source, sourceIndex };
}

interface FingerprintState {
  first: number;
  second: number;
  nodes: number;
}

function updateFingerprint(state: FingerprintState, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    state.first = Math.imul(state.first ^ code, 0x01000193) >>> 0;
    state.second = Math.imul(state.second ^ code, 0x85ebca6b) >>> 0;
    state.second = (state.second ^ (state.second >>> 13)) >>> 0;
  }
}

/**
 * Stable streaming serialization. Large data URLs are scanned in place instead of being copied
 * into one canonical JSON string, keeping the stale-check helper's peak memory bounded.
 */
function updateFingerprintValue(
  state: FingerprintState,
  value: unknown,
  ancestors: Set<object>,
  depth = 0,
): void {
  state.nodes += 1;
  if (depth > 64 || state.nodes > 200_000) {
    throw new TypeError("fingerprint structure budget exceeded");
  }
  if (value === null) {
    updateFingerprint(state, "null;");
    return;
  }
  if (typeof value === "string") {
    updateFingerprint(state, `s${value.length}:`);
    updateFingerprint(state, value);
    return;
  }
  if (typeof value === "boolean") {
    updateFingerprint(state, value ? "b1;" : "b0;");
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite fingerprint number");
    updateFingerprint(state, `n${String(value)};`);
    return;
  }
  if (typeof value !== "object") throw new TypeError("unsupported fingerprint value");
  if (ancestors.has(value)) throw new TypeError("circular fingerprint value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      updateFingerprint(state, `a${value.length}[`);
      for (const entry of value) {
        updateFingerprintValue(state, entry, ancestors, depth + 1);
      }
      updateFingerprint(state, "];");
      return;
    }
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      updateFingerprint(state, `v${bytes.length}:`);
      for (const byte of bytes) updateFingerprint(state, String.fromCharCode(byte));
      return;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    updateFingerprint(state, `o${keys.length}{`);
    for (const key of keys) {
      updateFingerprint(state, `k${key.length}:`);
      updateFingerprint(state, key);
      updateFingerprintValue(state, record[key], ancestors, depth + 1);
    }
    updateFingerprint(state, "};");
  } finally {
    ancestors.delete(value);
  }
}

function hashFingerprintValue(value: unknown): string {
  const state: FingerprintState = {
    first: 0x811c9dc5,
    second: 0x9e3779b9,
    nodes: 0,
  };
  updateFingerprintValue(state, value, new Set<object>());
  return `${SOURCE_FINGERPRINT_PREFIX}:${state.first.toString(16).padStart(8, "0")}${state.second
    .toString(16)
    .padStart(8, "0")}`;
}

/**
 * Fingerprints the complete source element plus its z-order position as a supplemental stale
 * signal. The document mutation ticket remains authoritative. Key insertion order does not
 * affect the result. Null means the source is missing, ineligible, or unsafe to inspect.
 */
export function fingerprintStudioLayerLiftSource(
  state: StudioLayerLiftSourceState,
): string | null {
  const inspected = inspectSource(state);
  if (!("source" in inspected)) return null;
  try {
    return hashFingerprintValue({
      sourceIndex: inspected.sourceIndex,
      source: inspected.source,
    });
  } catch {
    return null;
  }
}

/** Re-checks source ownership after asynchronous foreground/background generation. */
export function isStudioLayerLiftSourceCurrent(
  expectedFingerprint: string,
  current: StudioLayerLiftSourceState,
): boolean {
  if (
    typeof expectedFingerprint !== "string"
    || !expectedFingerprint.startsWith(`${SOURCE_FINGERPRINT_PREFIX}:`)
  ) {
    return false;
  }
  return fingerprintStudioLayerLiftSource(current) === expectedFingerprint;
}

function failure(
  input: PlanStudioLayerLiftInput,
  code: StudioLayerLiftPlanErrorCode,
  message: string,
): StudioLayerLiftPlanFailure {
  return {
    ok: false,
    code,
    message,
    nextElements: input.elements,
    nextGroups: input.groups,
  };
}

export function planStudioLayerLift(
  input: PlanStudioLayerLiftInput,
): StudioLayerLiftPlanResult {
  const inspected = inspectSource(input);
  if (!("source" in inspected)) {
    return failure(input, inspected.code, inspected.message);
  }

  const allocatedIds = [input.groupId, input.backgroundId, input.foregroundId];
  if (allocatedIds.some((id) => !isValidId(id))) {
    return failure(input, "invalid-id", "새 그룹과 레이어에 올바른 ID가 필요합니다.");
  }
  if (input.groupId === "page-root") {
    return failure(input, "invalid-id", "page-root는 새 레이어 그룹 ID로 사용할 수 없습니다.");
  }
  const allocationSet = new Set(allocatedIds);
  const occupiedIds = new Set([
    ...input.elements.map((element) => element.id),
    ...input.groups.map((group) => group.id),
  ]);
  const occupiedMembershipIds = new Set(
    input.elements
      .map((element) => element.groupId)
      .filter((groupId): groupId is string => groupId !== undefined),
  );
  if (
    allocationSet.size !== allocatedIds.length
    || allocatedIds.some((id) => occupiedIds.has(id))
    || occupiedMembershipIds.has(input.groupId)
  ) {
    return failure(
      input,
      "duplicate-id",
      "새 그룹과 레이어 ID는 서로 다르고 문서에서 사용되지 않아야 합니다.",
    );
  }

  const backgroundBytes = pngDataUrlByteLength(input.backgroundPngDataUrl);
  const foregroundBytes = pngDataUrlByteLength(input.foregroundPngDataUrl);
  if (backgroundBytes === null || foregroundBytes === null) {
    return failure(
      input,
      "invalid-output",
      "배경과 전경 결과가 올바른 PNG data URL이 아닙니다.",
    );
  }
  if (backgroundBytes > MAX_PNG_BYTES || foregroundBytes > MAX_PNG_BYTES) {
    return failure(
      input,
      "invalid-output",
      "배경과 전경 PNG가 저장 가능한 8MB 한도를 넘습니다.",
    );
  }
  if (input.outputBasis !== STUDIO_LAYER_LIFT_OUTPUT_BASIS) {
    return failure(
      input,
      "invalid-output-basis",
      "현재 보이는 이미지 외형을 평탄화한 결과만 레이어로 분리할 수 있습니다.",
    );
  }
  if (input.persistenceScope !== STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE) {
    return failure(
      input,
      "invalid-persistence-scope",
      "저장된 협업 원고에는 결과 에셋을 먼저 일괄 업로드해야 합니다.",
    );
  }

  const groupName = input.groupName ?? STUDIO_LAYER_LIFT_DEFAULT_GROUP_NAME;
  if (!validGroupName(groupName)) {
    return failure(input, "invalid-group-name", "그룹 이름이 비어 있거나 올바르지 않습니다.");
  }
  if (
    input.confidence !== undefined
    && (
      !Number.isFinite(input.confidence)
      || input.confidence < 0
      || input.confidence > 1
    )
  ) {
    return failure(input, "invalid-confidence", "분리 신뢰도는 0과 1 사이여야 합니다.");
  }

  const sourceFingerprint = fingerprintStudioLayerLiftSource(input);
  if (sourceFingerprint === null) {
    return failure(
      input,
      "source-unfingerprintable",
      "원본 레이어 상태를 안전하게 확인할 수 없어 분리를 중단했습니다.",
    );
  }

  const { source, sourceIndex } = inspected;
  const original: StudioLayerLiftSource = {
    ...source,
    name: STUDIO_LAYER_LIFT_MEMBER_NAMES.original,
    groupId: input.groupId,
    hidden: true,
    locked: true,
  };
  const background = imageOutputFromFlattenedSource(source, {
    id: input.backgroundId,
    name: STUDIO_LAYER_LIFT_MEMBER_NAMES.background,
    src: input.backgroundPngDataUrl,
    groupId: input.groupId,
  });
  const foreground = imageOutputFromFlattenedSource(source, {
    id: input.foregroundId,
    name: STUDIO_LAYER_LIFT_MEMBER_NAMES.foreground,
    src: input.foregroundPngDataUrl,
    groupId: input.groupId,
  });
  const nextElements = [
    ...input.elements.slice(0, sourceIndex),
    original,
    background,
    foreground,
    ...input.elements.slice(sourceIndex + 1),
  ];
  if (!hasContiguousLayerGroups(nextElements)) {
    return failure(
      input,
      "noncontiguous-groups",
      "분리 결과가 기존 그룹 연속성을 유지하지 못해 적용하지 않았습니다.",
    );
  }

  const newGroup = createLayerGroup(input.groupId, groupName);
  return {
    ok: true,
    sourceId: input.sourceId,
    sourceFingerprint,
    newGroup,
    nextElements,
    nextGroups: [...input.groups, newGroup],
    selectedId: input.foregroundId,
    diagnostics: {
      sourceIndex,
      confidence: input.confidence ?? null,
      memberOrder: BACK_TO_FRONT_ROLES,
      outputByteLengths: {
        background: backgroundBytes,
        foreground: foregroundBytes,
      },
    },
  };
}
