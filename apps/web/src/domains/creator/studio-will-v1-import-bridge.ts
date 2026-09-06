/**
 * Safe Studio import bridge for the clean-room, bounded WILL v1 Annex B profile.
 *
 * The strict OPC/ZIP parser always runs in the dedicated one-shot Worker. This bridge starts only
 * after file selection, turns validated Catmull-Rom paths into bounded Studio freehand elements,
 * and publishes every approximation in the shared loss-preview vocabulary. It is not a Wacom SDK,
 * Wacom certification, or a claim of arbitrary vendor `.will` interoperability.
 */

import { STUDIO_INK_MAX_BRUSH_SIZE } from "./brush/studio-ink-pressure-model";
import { catmullRomPoint } from "./studio-curve-smoothing";
import {
  summarizeStudioInterchangeLoss,
  type StudioInterchangeLossConstraint,
  type StudioInterchangeLossPreviewInput,
} from "./studio-interchange-loss-preview";
import {
  STUDIO_PROJECT_MAX_CANVAS_HEIGHT,
} from "./studio-project-file";

import type { DrawEl } from "./studio-element-model";
import type {
  StudioWillV1Path,
} from "./studio-will-v1-interchange";
import type {
  StudioWillV1OpcImportResult,
} from "./studio-will-v1-opc-interchange";
import type {
  StudioWillV1OpcWorkerOptions,
} from "./studio-will-v1-opc-worker-client";

export const STUDIO_WILL_V1_IMPORT_MEDIA_TYPE =
  "application/vnd.toonspectrum.will-v1-bounded+zip" as const;
export const STUDIO_WILL_V1_IMPORT_ACCEPT =
  ".will,application/vnd.toonspectrum.will-v1-bounded+zip" as const;
export const STUDIO_WILL_V1_IMPORT_PROFILE_LABEL =
  "ToonSpectrum bounded WILL v1 Annex B public-spec profile" as const;
export const STUDIO_WILL_V1_IMPORT_DISCLAIMER =
  "ToonSpectrum의 공개 명세 기반 bounded profile만 가져오며 Wacom 공식 SDK·인증 파일 호환을 보증하지 않습니다." as const;

/** Matches the persisted project schema and the CRDT page mutation boundary. */
export const STUDIO_WILL_V1_IMPORT_MAX_ELEMENTS_PER_PAGE = 10_000;
/** Keeps one CRDT scene element comfortably below its 16 KiB canonical JSON budget. */
export const STUDIO_WILL_V1_IMPORT_MAX_SAMPLES_PER_ELEMENT = 192;
/**
 * Defense-in-depth cap before Studio performs any Catmull-Rom sampling. The transport may validate
 * a much larger aggregate document, but one retained Studio path is intentionally limited to the
 * current public-profile per-path envelope. This prevents a future/foreign Worker result from
 * expanding one million control points into multi-million temporary main-thread arrays.
 */
export const STUDIO_WILL_V1_IMPORT_MAX_SOURCE_CONTROL_POINTS_PER_PATH = 100_000;
/**
 * Studio UI admission budget enforced inside the Worker parser and again by the main-thread packed
 * decoder before it creates point objects. The generic codec can still validate one million source
 * points, but an interactive import cannot expand more than this into `{x,y}` objects, retained
 * DrawEl arrays, or history snapshots.
 */
export const STUDIO_WILL_V1_IMPORT_MAX_STUDIO_SAMPLES = 200_000;
const STUDIO_WILL_V1_IMPORT_MIN_BRUSH_SIZE = 0.01;
const STUDIO_WILL_V1_IMPORT_MAX_COORDINATE_MAGNITUDE = 10_000_000;

export type StudioWillV1ImportAdaptationReason =
  | "catmull-rom-resampled-to-studio-polyline"
  | "document-scaled-to-studio-width"
  | "path-split-for-collaboration-budget"
  | "stroke-width-mapped-to-pressure"
  | "stroke-width-scaled-to-studio-range";

export interface StudioWillV1ImportAdaptation {
  readonly reason: StudioWillV1ImportAdaptationReason;
  readonly count: number;
}

export type StudioWillV1ImportSkipReason =
  | "coordinate-outside-studio-safe-range"
  | "sample-budget-exceeded";

export interface StudioWillV1ImportSkip {
  readonly pathIndex: number;
  readonly reason: StudioWillV1ImportSkipReason;
}

export interface StudioWillV1ImportedStrokeDraft {
  readonly stableIdBase: string;
  readonly sourcePathIndex: number;
  readonly element: Omit<DrawEl, "id">;
}

export interface PendingStudioWillV1Import {
  readonly kind: "will-v1";
  readonly fileName: string;
  readonly result: StudioWillV1OpcImportResult;
  readonly preview: StudioInterchangeLossPreviewInput;
  readonly sourceFingerprint: `willfp:${string}`;
  readonly pageHeight: number;
  readonly drafts: readonly StudioWillV1ImportedStrokeDraft[];
  readonly adaptations: readonly StudioWillV1ImportAdaptation[];
  readonly skipped: readonly StudioWillV1ImportSkip[];
  readonly currentPageAllowed: boolean;
  readonly newPageAllowed: boolean;
  readonly disclaimer: typeof STUDIO_WILL_V1_IMPORT_DISCLAIMER;
}

export interface StudioWillV1ImportInspectionOptions {
  readonly canvasWidth: number;
  readonly currentPageElementCount: number;
  readonly canAddPage: boolean;
  readonly signal?: AbortSignal;
  readonly workerOptions?: Omit<StudioWillV1OpcWorkerOptions, "signal">;
}

export interface StudioWillV1ImportCommitOptions {
  readonly existingElementIds: ReadonlySet<string>;
  readonly currentPageElementCount: number;
  readonly destination: "current-page" | "new-page";
}

export interface StudioWillV1ImportCommitDraft {
  readonly elements: readonly DrawEl[];
  readonly pageHeight: number;
  readonly title: string;
  readonly status: Readonly<{
    tone: "good" | "warn";
    text: string;
  }>;
}

function studioWillV1ImportWorkerOptions(
  options: StudioWillV1ImportInspectionOptions["workerOptions"],
): Omit<StudioWillV1OpcWorkerOptions, "signal"> {
  const suppliedWillLimits = options?.willLimits;
  return {
    ...options,
    willLimits: {
      ...suppliedWillLimits,
      maxPointsPerPath: Math.min(
        suppliedWillLimits?.maxPointsPerPath
          ?? STUDIO_WILL_V1_IMPORT_MAX_SOURCE_CONTROL_POINTS_PER_PATH,
        STUDIO_WILL_V1_IMPORT_MAX_SOURCE_CONTROL_POINTS_PER_PATH,
      ),
      maxTotalPoints: Math.min(
        suppliedWillLimits?.maxTotalPoints
          ?? STUDIO_WILL_V1_IMPORT_MAX_STUDIO_SAMPLES,
        STUDIO_WILL_V1_IMPORT_MAX_STUDIO_SAMPLES,
      ),
    },
  };
}

interface SampledPath {
  readonly points: readonly number[];
  readonly widths: readonly number[];
  readonly maximumWidth: number;
  readonly minimumWidth: number;
}

type SampledPathAttempt =
  | Readonly<{ kind: "sampled"; sampled: SampledPath }>
  | Readonly<{ kind: "coordinate-invalid" }>
  | Readonly<{ kind: "sample-budget-exceeded" }>;

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("WILL v1 가져오기를 취소했습니다.");
  error.name = "AbortError";
  throw error;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`WILL v1 ${label} 값이 올바르지 않습니다.`);
  }
  return value;
}

function safeFileName(value: string): string {
  const name = Array.from(value.trim())
    .filter((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point >= 0x20 && point !== 0x7f;
    })
    .join("")
    .slice(0, 240);
  return name || "가져올 WILL v1 파일";
}

function safePageTitle(result: StudioWillV1OpcImportResult, fileName: string): string {
  const fromMetadata = Array.from(result.title.trim()).slice(0, 120).join("");
  if (fromMetadata && fromMetadata !== "Untitled") return fromMetadata;
  const fromFile = fileName.replace(/\.will$/iu, "").trim();
  return Array.from(fromFile).slice(0, 120).join("") || "WILL v1 가져오기";
}

function assuranceIsBoundedPublicProfile(
  result: StudioWillV1OpcImportResult,
  expectedProfile: string,
): boolean {
  const assurance = result.assurance;
  return (
    assurance.profile === expectedProfile
    && assurance.implementation === "ToonSpectrum clean-room bounded profile"
    && assurance.annexAPathStream === true
    && assurance.annexBOpcSevenPartContainer === true
    && assurance.canonicalTopLevelMediaTypeOwner === "ToonSpectrum"
    && assurance.vendorCertified === false
    && assurance.vendorTrademarkAuthorized === false
    && assurance.arbitraryVendorFileInteroperabilityCertified === false
  );
}

interface StableHashState {
  first: number;
  second: number;
}

function stableHashState(): StableHashState {
  return {
    first: 0x811c9dc5,
    second: 0x9e3779b9,
  };
}

function updateStableHashByte(state: StableHashState, byte: number): void {
  state.first = Math.imul(state.first ^ byte, 0x01000193) >>> 0;
  state.second = Math.imul(state.second ^ byte, 0x85ebca6b) >>> 0;
}

function updateStableHashText(state: StableHashState, value: string): void {
  for (const byte of new TextEncoder().encode(value)) updateStableHashByte(state, byte);
  updateStableHashByte(state, 0xff);
}

const stableNumberBuffer = new ArrayBuffer(8);
const stableNumberView = new DataView(stableNumberBuffer);

function updateStableHashNumber(state: StableHashState, value: number): void {
  stableNumberView.setFloat64(0, value, true);
  for (let index = 0; index < 8; index += 1) {
    updateStableHashByte(state, stableNumberView.getUint8(index));
  }
}

function finishStableHash(state: StableHashState): string {
  return `${state.first.toString(16).padStart(8, "0")}${state.second.toString(16).padStart(8, "0")}`;
}

/**
 * Allocation-bounded replay identity, not a cryptographic integrity digest. The strict Worker owns
 * archive integrity; this streaming hash only keeps imported element IDs deterministic without
 * JSON-stringifying up to one million points on the main thread.
 */
function stablePathFingerprint(path: StudioWillV1Path): string {
  const state = stableHashState();
  updateStableHashNumber(state, path.startParameter);
  updateStableHashNumber(state, path.endParameter);
  updateStableHashNumber(state, path.decimalPrecision);
  updateStableHashNumber(state, path.segmentCount);
  for (const point of path.points) {
    updateStableHashNumber(state, point.x);
    updateStableHashNumber(state, point.y);
  }
  updateStableHashByte(state, 0xfe);
  for (const width of path.strokeWidths) updateStableHashNumber(state, width);
  updateStableHashByte(state, path.strokeColor.r);
  updateStableHashByte(state, path.strokeColor.g);
  updateStableHashByte(state, path.strokeColor.b);
  updateStableHashByte(state, path.strokeColor.a);
  return finishStableHash(state);
}

function stableSkippedPathFingerprint(
  path: StudioWillV1Path,
  reason: StudioWillV1ImportSkipReason,
): string {
  const state = stableHashState();
  updateStableHashText(state, "skipped");
  updateStableHashText(state, reason);
  updateStableHashNumber(state, path.points.length);
  updateStableHashNumber(state, path.strokeWidths.length);
  updateStableHashNumber(state, path.startParameter);
  updateStableHashNumber(state, path.endParameter);
  updateStableHashNumber(state, path.decimalPrecision);
  updateStableHashNumber(state, path.segmentCount);
  updateStableHashByte(state, path.strokeColor.r);
  updateStableHashByte(state, path.strokeColor.g);
  updateStableHashByte(state, path.strokeColor.b);
  updateStableHashByte(state, path.strokeColor.a);
  return `skipped:${finishStableHash(state)}`;
}

function stableDocumentFingerprint(
  result: StudioWillV1OpcImportResult,
  pathFingerprints: readonly string[],
): `willfp:${string}` {
  const state = stableHashState();
  updateStableHashText(state, result.assurance.profile);
  updateStableHashNumber(state, result.width);
  updateStableHashNumber(state, result.height);
  updateStableHashText(state, result.title);
  updateStableHashText(state, result.createdAt);
  updateStableHashText(state, result.application);
  updateStableHashText(state, result.applicationVersion);
  for (const pathFingerprint of pathFingerprints) {
    updateStableHashText(state, pathFingerprint);
  }
  return `willfp:${finishStableHash(state)}`;
}

function sameSample(
  points: readonly number[],
  widths: readonly number[],
  x: number,
  y: number,
  width: number,
): boolean {
  const pointOffset = points.length - 2;
  return (
    pointOffset >= 0
    && points[pointOffset] === x
    && points[pointOffset + 1] === y
    && widths.at(-1) === width
  );
}

function sampledPath(
  path: StudioWillV1Path,
  scale: number,
  maximumSamples: number,
): SampledPathAttempt {
  const points: number[] = [];
  const widths: number[] = [];
  const lastSegment = path.segmentCount - 1;
  for (let segment = 0; segment < path.segmentCount; segment += 1) {
    const firstT = segment === 0 ? path.startParameter : 0;
    const lastT = segment === lastSegment ? path.endParameter : 1;
    if (firstT > lastT) return Object.freeze({ kind: "coordinate-invalid" });
    const tValues = firstT === lastT
      ? [firstT]
      : [firstT, firstT + (lastT - firstT) / 2, lastT];
    const p0 = path.points[segment]!;
    const p1 = path.points[segment + 1]!;
    const p2 = path.points[segment + 2]!;
    const p3 = path.points[segment + 3]!;
    // WILL v1 explicitly repeats the final supplied width when the width stream is shorter than
    // the control-point stream. A common constant-width path therefore contains exactly one width.
    const lastWidthIndex = path.strokeWidths.length - 1;
    const widthStart = path.strokeWidths[Math.min(segment + 1, lastWidthIndex)]!;
    const widthEnd = path.strokeWidths[Math.min(segment + 2, lastWidthIndex)]!;
    for (const t of tValues) {
      const point = catmullRomPoint(p0, p1, p2, p3, t);
      const x = point.x * scale;
      const y = point.y * scale;
      const width = (widthStart + (widthEnd - widthStart) * t) * scale;
      if (
        !Number.isFinite(x)
        || !Number.isFinite(y)
        || !Number.isFinite(width)
        || width <= 0
        || Math.abs(x) > STUDIO_WILL_V1_IMPORT_MAX_COORDINATE_MAGNITUDE
        || Math.abs(y) > STUDIO_WILL_V1_IMPORT_MAX_COORDINATE_MAGNITUDE
      ) {
        return Object.freeze({ kind: "coordinate-invalid" });
      }
      if (!sameSample(points, widths, x, y, width)) {
        if (widths.length >= maximumSamples) {
          return Object.freeze({ kind: "sample-budget-exceeded" });
        }
        points.push(x, y);
        widths.push(width);
      }
    }
  }
  if (widths.length === 0) return Object.freeze({ kind: "coordinate-invalid" });
  if (widths.length === 1) {
    if (maximumSamples < 2) {
      return Object.freeze({ kind: "sample-budget-exceeded" });
    }
    points.push(points[0]!, points[1]!);
    widths.push(widths[0]!);
  }
  return Object.freeze({
    kind: "sampled",
    sampled: sampledPathWithStats(points, widths),
  });
}

function sampledPathWithStats(points: number[], widths: number[]): SampledPath {
  let maximumWidth = 0;
  let minimumWidth = Number.POSITIVE_INFINITY;
  for (const width of widths) {
    maximumWidth = Math.max(maximumWidth, width);
    minimumWidth = Math.min(minimumWidth, width);
  }
  return Object.freeze({
    points: Object.freeze(points),
    widths: Object.freeze(widths),
    maximumWidth,
    minimumWidth,
  });
}

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function splitSampledPath(
  sampled: SampledPath,
): readonly SampledPath[] {
  const pointCount = sampled.widths.length;
  if (pointCount <= STUDIO_WILL_V1_IMPORT_MAX_SAMPLES_PER_ELEMENT) {
    return Object.freeze([sampled]);
  }
  const chunks: SampledPath[] = [];
  let start = 0;
  while (start < pointCount) {
    const end = Math.min(
      pointCount,
      start + STUDIO_WILL_V1_IMPORT_MAX_SAMPLES_PER_ELEMENT,
    );
    const points = sampled.points.slice(start * 2, end * 2);
    const widths = sampled.widths.slice(start, end);
    if (widths.length === 1) {
      points.push(points[0]!, points[1]!);
      widths.push(widths[0]!);
    }
    chunks.push(sampledPathWithStats(points, widths));
    if (end >= pointCount) break;
    start = end - 1;
  }
  return Object.freeze(chunks);
}

function elementDraft(
  path: StudioWillV1Path,
  sampled: SampledPath,
  stableIdBase: string,
  sourcePathIndex: number,
): StudioWillV1ImportedStrokeDraft {
  const maximumWidth = sampled.maximumWidth;
  const boundedBaseWidth = Math.min(
    STUDIO_INK_MAX_BRUSH_SIZE,
    Math.max(STUDIO_WILL_V1_IMPORT_MIN_BRUSH_SIZE, maximumWidth),
  );
  const widthScale = boundedBaseWidth / maximumWidth;
  const pressures = sampled.widths.map((width) =>
    Math.min(1, Math.max(0, (width * widthScale) / boundedBaseWidth))
  );
  const { r, g, b, a } = path.strokeColor;
  return Object.freeze({
    stableIdBase,
    sourcePathIndex,
    element: Object.freeze({
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [...sampled.points],
      stroke: `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`,
      strokeWidth: boundedBaseWidth,
      opacity: a / 255,
      brush: "pen",
      brushCatalogId: "will-v1-import-pen",
      brushCatalogName: "WILL v1 가져온 선",
      pressures,
      pressureModel: "linear-residual-path-v3",
      paintModel: "layered-flow-v1",
      sampleSpacing: 1,
      name: `WILL 선 ${sourcePathIndex + 1}`,
    }),
  });
}

function incrementAdaptation(
  map: Map<StudioWillV1ImportAdaptationReason, number>,
  reason: StudioWillV1ImportAdaptationReason,
  count = 1,
): void {
  map.set(reason, (map.get(reason) ?? 0) + count);
}

function constraintsForInspection(input: {
  readonly adaptations: readonly StudioWillV1ImportAdaptation[];
  readonly drafts: readonly StudioWillV1ImportedStrokeDraft[];
  readonly pageHeight: number;
  readonly scale: number;
  readonly skipped: readonly StudioWillV1ImportSkip[];
  readonly canUseAnyDestination: boolean;
}): StudioInterchangeLossConstraint[] {
  const constraints: StudioInterchangeLossConstraint[] = [
    {
      category: "editability",
      severity: "notice",
      message: STUDIO_WILL_V1_IMPORT_DISCLAIMER,
    },
  ];
  if (input.scale !== 1) {
    constraints.push({
      category: "resolution",
      severity: "notice",
      message: `문서 폭을 Studio 캔버스에 맞추기 위해 좌표와 선폭을 ${input.scale.toFixed(4)}배로 조정합니다.`,
    });
  }
  if (input.adaptations.some(({ reason }) =>
    reason === "catmull-rom-resampled-to-studio-polyline"
  )) {
    constraints.push({
      category: "editability",
      severity: "warning",
      message: "Catmull–Rom 곡선을 편집 가능한 Studio 자유곡선 샘플로 변환합니다.",
    });
  }
  if (input.adaptations.some(({ reason }) =>
    reason === "stroke-width-mapped-to-pressure"
  )) {
    constraints.push({
      category: "editability",
      severity: "notice",
      message: "WILL의 점별 선폭을 Studio의 기준 굵기와 점별 필압으로 보존합니다.",
    });
  }
  const splitCount = input.adaptations.find(({ reason }) =>
    reason === "path-split-for-collaboration-budget"
  )?.count ?? 0;
  if (splitCount > 0) {
    constraints.push({
      category: "layers",
      severity: "notice",
      message: `공동 편집·저장 예산을 지키기 위해 긴 경로를 ${splitCount.toLocaleString("ko-KR")}개 연속 요소로 나눕니다.`,
    });
  }
  if (input.adaptations.some(({ reason }) =>
    reason === "stroke-width-scaled-to-studio-range"
  )) {
    constraints.push({
      category: "editability",
      severity: "warning",
      message: `Studio 지원 굵기 ${STUDIO_WILL_V1_IMPORT_MIN_BRUSH_SIZE}–${STUDIO_INK_MAX_BRUSH_SIZE.toLocaleString("ko-KR")}px 범위에 맞춰 경로 내부 굵기 비율을 유지하며 균일 조정합니다.`,
    });
  }
  if (input.skipped.length > 0) {
    constraints.push({
      category: "editability",
      severity: "warning",
      message: `Studio 안전 좌표·샘플 예산을 넘은 경로 ${input.skipped.length.toLocaleString("ko-KR")}개는 적용 대상에서 제외합니다.`,
    });
  }
  if (input.drafts.length === 0) {
    constraints.push({
      category: "editability",
      gate: "blocking",
      message: "Studio에서 표시할 수 있는 WILL v1 경로가 없어 가져올 수 없습니다.",
    });
  }
  if (input.drafts.length > STUDIO_WILL_V1_IMPORT_MAX_ELEMENTS_PER_PAGE) {
    constraints.push({
      category: "layers",
      gate: "blocking",
      message: `가져온 요소 ${input.drafts.length.toLocaleString("ko-KR")}개가 페이지 저장 한도 ${STUDIO_WILL_V1_IMPORT_MAX_ELEMENTS_PER_PAGE.toLocaleString("ko-KR")}개를 넘습니다.`,
    });
  }
  if (input.pageHeight > STUDIO_PROJECT_MAX_CANVAS_HEIGHT) {
    constraints.push({
      category: "resolution",
      gate: "blocking",
      message: `적용 높이 ${input.pageHeight.toLocaleString("ko-KR")}px가 Studio 페이지 저장 한도 ${STUDIO_PROJECT_MAX_CANVAS_HEIGHT.toLocaleString("ko-KR")}px를 넘습니다.`,
    });
  }
  if (!input.canUseAnyDestination) {
    constraints.push({
      category: "pages",
      gate: "blocking",
      message: "새 페이지 저장 한도에 도달했고 현재 페이지의 요소 여유도 부족해 가져올 위치가 없습니다.",
    });
  }
  return constraints;
}

/**
 * Decodes the strict seven-part profile in the dedicated Worker and prepares a non-mutating loss
 * preview. Invalid/foreign profiles never produce a pending import.
 */
export async function inspectStudioWillV1Import(
  source: Blob | Uint8Array | ArrayBuffer,
  fileName: string,
  options: StudioWillV1ImportInspectionOptions,
): Promise<PendingStudioWillV1Import> {
  throwIfAborted(options.signal);
  const canvasWidth = finitePositive(options.canvasWidth, "Studio 캔버스 폭");
  if (
    !Number.isSafeInteger(options.currentPageElementCount)
    || options.currentPageElementCount < 0
    || options.currentPageElementCount > STUDIO_WILL_V1_IMPORT_MAX_ELEMENTS_PER_PAGE
  ) {
    throw new Error("현재 페이지 요소 수가 Studio 저장 한도와 일치하지 않습니다.");
  }
  const [
    { importStudioWillV1OpcInWorker },
    { STUDIO_WILL_V1_OPC_PROFILE },
  ] = await Promise.all([
    import("./studio-will-v1-opc-worker-client"),
    import("./studio-will-v1-opc-interchange"),
  ]);
  const result = await importStudioWillV1OpcInWorker(source, {
    ...studioWillV1ImportWorkerOptions(options.workerOptions),
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  if (!assuranceIsBoundedPublicProfile(result, STUDIO_WILL_V1_OPC_PROFILE)) {
    throw new Error(
      "이 파일은 ToonSpectrum bounded WILL v1 공개 명세 프로필로 검증되지 않아 가져오지 않았습니다.",
    );
  }

  const scale = canvasWidth / finitePositive(result.width, "문서 폭");
  const pageHeight = Math.max(1, Math.round(finitePositive(result.height, "문서 높이") * scale));
  const pathFingerprints: string[] = [];
  const adaptations = new Map<StudioWillV1ImportAdaptationReason, number>();
  const skipped: StudioWillV1ImportSkip[] = [];
  const drafts: StudioWillV1ImportedStrokeDraft[] = [];
  let totalSamples = 0;
  if (scale !== 1) incrementAdaptation(adaptations, "document-scaled-to-studio-width");

  for (let pathIndex = 0; pathIndex < result.paths.length; pathIndex += 1) {
    const path = result.paths[pathIndex]!;
    if (
      path.points.length
      > STUDIO_WILL_V1_IMPORT_MAX_SOURCE_CONTROL_POINTS_PER_PATH
    ) {
      const reason = "sample-budget-exceeded";
      skipped.push({ pathIndex, reason });
      pathFingerprints.push(stableSkippedPathFingerprint(path, reason));
      continue;
    }
    const attempted = sampledPath(
      path,
      scale,
      STUDIO_WILL_V1_IMPORT_MAX_STUDIO_SAMPLES - totalSamples,
    );
    if (attempted.kind !== "sampled") {
      const reason = attempted.kind === "sample-budget-exceeded"
        ? "sample-budget-exceeded"
        : "coordinate-outside-studio-safe-range";
      skipped.push({ pathIndex, reason });
      pathFingerprints.push(stableSkippedPathFingerprint(path, reason));
      continue;
    }
    const sampled = attempted.sampled;
    totalSamples += sampled.widths.length;
    const pathFingerprint = stablePathFingerprint(path);
    pathFingerprints.push(pathFingerprint);
    incrementAdaptation(adaptations, "catmull-rom-resampled-to-studio-polyline");
    if (sampled.maximumWidth !== sampled.minimumWidth) {
      incrementAdaptation(adaptations, "stroke-width-mapped-to-pressure");
    }
    if (
      sampled.maximumWidth > STUDIO_INK_MAX_BRUSH_SIZE
      || sampled.maximumWidth < STUDIO_WILL_V1_IMPORT_MIN_BRUSH_SIZE
    ) {
      incrementAdaptation(adaptations, "stroke-width-scaled-to-studio-range");
    }
    const chunks = splitSampledPath(sampled);
    if (chunks.length > 1) {
      incrementAdaptation(
        adaptations,
        "path-split-for-collaboration-budget",
        chunks.length,
      );
    }
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const idBase = `will-${pathFingerprint}-${pathIndex.toString(36)}-${chunkIndex.toString(36)}`;
      drafts.push(elementDraft(path, chunks[chunkIndex]!, idBase, pathIndex));
    }
  }

  const sourceFingerprint = stableDocumentFingerprint(result, pathFingerprints);
  const frozenAdaptations = Object.freeze(
    [...adaptations.entries()].map(([reason, count]) => Object.freeze({ reason, count })),
  );
  const frozenSkipped = Object.freeze(skipped.map((item) => Object.freeze(item)));
  const frozenDrafts = Object.freeze(drafts);
  const currentPageAllowed =
    options.currentPageElementCount + frozenDrafts.length
    <= STUDIO_WILL_V1_IMPORT_MAX_ELEMENTS_PER_PAGE;
  const newPageAllowed =
    options.canAddPage
    && frozenDrafts.length <= STUDIO_WILL_V1_IMPORT_MAX_ELEMENTS_PER_PAGE;
  const constraints = constraintsForInspection({
    adaptations: frozenAdaptations,
    drafts: frozenDrafts,
    pageHeight,
    scale,
    skipped: frozenSkipped,
    canUseAnyDestination: currentPageAllowed || newPageAllowed,
  });
  const preview: StudioInterchangeLossPreviewInput = Object.freeze({
    format: "raster",
    formatLabel: "WILL v1 (bounded)",
    fileName: safeFileName(fileName),
    source: Object.freeze({
      pageCount: 1,
      layerCount: result.paths.length,
      width: Math.max(1, Math.round(result.width)),
      height: Math.max(1, Math.round(result.height)),
      alpha: result.paths.some(({ strokeColor }) => strokeColor.a < 255)
        ? "present"
        : "opaque",
      colorSpace: "WILL v1 8-bit RGBA (프로필 미지정)",
      editability: "layered",
    }),
    result: Object.freeze({
      pageCount: 1,
      layerCount: frozenDrafts.length,
      width: Math.max(1, Math.round(canvasWidth)),
      height: pageHeight,
      alpha: result.paths.some(({ strokeColor }) => strokeColor.a < 255)
        ? "present"
        : "opaque",
      colorSpace: "Studio sRGB",
      editability: "layered",
    }),
    proxy: Object.freeze({
      enabled: false,
      originalRetained: false,
    }),
    constraints: Object.freeze(constraints.map((item) => Object.freeze(item))),
  });
  return Object.freeze({
    kind: "will-v1",
    fileName: safeFileName(fileName),
    result,
    preview,
    sourceFingerprint,
    pageHeight,
    drafts: frozenDrafts,
    adaptations: frozenAdaptations,
    skipped: frozenSkipped,
    currentPageAllowed,
    newPageAllowed,
    disclaimer: STUDIO_WILL_V1_IMPORT_DISCLAIMER,
  });
}

function allocateStableId(base: string, reserved: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (reserved.has(candidate)) {
    candidate = `${base}-${suffix.toString(36)}`;
    suffix += 1;
  }
  reserved.add(candidate);
  return candidate;
}

/**
 * Produces immutable elements only after an explicit destination choice. The caller must commit
 * the resulting complete page transition through Studio's normal history/CRDT mutation function.
 */
export function prepareStudioWillV1ImportCommit(
  pending: PendingStudioWillV1Import,
  options: StudioWillV1ImportCommitOptions,
): StudioWillV1ImportCommitDraft {
  const summary = summarizeStudioInterchangeLoss(pending.preview);
  if (!summary.canConfirm) {
    throw new Error("차단된 WILL v1 손실 항목을 해결한 뒤 다시 검사해 주세요.");
  }
  if (options.destination !== "new-page" && options.destination !== "current-page") {
    throw new Error("WILL v1을 가져올 위치를 먼저 선택해 주세요.");
  }
  if (options.destination === "new-page" && !pending.newPageAllowed) {
    throw new Error("검사 시점의 프로젝트·페이지 한도 때문에 새 페이지에 WILL v1을 추가할 수 없습니다.");
  }
  if (options.destination === "current-page" && !pending.currentPageAllowed) {
    throw new Error("검사 시점의 페이지 요소 한도 때문에 현재 페이지에 WILL v1을 추가할 수 없습니다.");
  }
  if (
    !Number.isSafeInteger(options.currentPageElementCount)
    || options.currentPageElementCount < 0
    || options.currentPageElementCount > STUDIO_WILL_V1_IMPORT_MAX_ELEMENTS_PER_PAGE
  ) {
    throw new Error("현재 페이지 요소 수가 Studio 저장 한도와 일치하지 않습니다.");
  }
  if (
    options.destination === "current-page"
    && options.currentPageElementCount + pending.drafts.length
      > STUDIO_WILL_V1_IMPORT_MAX_ELEMENTS_PER_PAGE
  ) {
    throw new Error(
      `현재 페이지에 추가하면 요소 저장 한도 ${STUDIO_WILL_V1_IMPORT_MAX_ELEMENTS_PER_PAGE.toLocaleString("ko-KR")}개를 넘습니다. 새 페이지에 추가해 주세요.`,
    );
  }
  const reserved = new Set(options.existingElementIds);
  const elements = pending.drafts.map((draft): DrawEl => ({
    ...draft.element,
    points: [...draft.element.points],
    pressures: draft.element.pressures ? [...draft.element.pressures] : undefined,
    id: allocateStableId(draft.stableIdBase, reserved),
  }));
  const changeCount = pending.adaptations.reduce((total, item) => total + item.count, 0);
  const warningCount = changeCount + pending.skipped.length;
  return Object.freeze({
    elements: Object.freeze(elements),
    pageHeight: pending.pageHeight,
    title: safePageTitle(pending.result, pending.fileName),
    status: Object.freeze({
      tone: warningCount > 0 ? "warn" : "good",
      text: `WILL v1 선 ${elements.length.toLocaleString("ko-KR")}개를 ${options.destination === "new-page" ? "새 페이지에" : "현재 페이지 위에"} 추가했어요.${
        warningCount > 0
          ? ` 변환·제외 알림 ${warningCount.toLocaleString("ko-KR")}건을 손실 미리보기에서 확인했어요.`
          : ""
      }`,
    }),
  });
}
