/**
 * Brush pack import router — one entry point for every brush file the studio
 * can actually turn into a drawable brush.
 *
 * Photoshop `.abr` already had a worker-backed lane (`studio-abr-import.ts`) and
 * the app-private `.json` format had `importBrushFromJson`. libmypaint `.myb`
 * and Krita `.kpp` had *parsers* in `packages/studio-format-gateway` producing a
 * `BrushProgramIR`, but nothing mapped that IR onto the snapshot the drawing
 * engine consumes, so neither format had a user-reachable path. This module is
 * that missing map, plus the sniffing that puts all four formats behind one
 * file input.
 *
 * Two rules it never breaks:
 *
 * 1. **Nothing fake is registered.** Only IR fields with a real snapshot
 *    counterpart become brush settings. Everything the parsers report as
 *    unmapped, plus every field this map cannot carry, is returned in
 *    `warnings`/`unmapped` for the UI to show — a brush that "imported fine"
 *    but silently drew nothing like the source is the failure mode this avoids.
 * 2. **What is registered draws.** The produced `StudioBrushSnapshot` is the
 *    same shape `applySavedBrush` feeds the pen, so an imported preset goes
 *    straight into `planStudioDynamicBrushDabs` (see the round-trip test).
 *
 * Size encodings differ per lane and are detected, not guessed:
 * - Krita `paintbrush` presets carry the base diameter as a **constant** size
 *   mapping normalized against Krita's stock 1000 px cap (`kpp.ts`).
 * - libmypaint (`.myb`, and `.kpp` `mypaintbrush` presets, which the gateway
 *   delegates to the myb lane) carries `radius_logarithmic` folded into the
 *   **pressure** LUT divided by 6, so the px radius is `exp(tap * 6)`.
 */

import {
  importCspToolFile,
  CspToolFileError,
  type CspSutSqliteReader,
  type CspToolFileImportResult,
} from "../../../../../../packages/studio-format-gateway/src/csp-sut";
import { parseKppPreset, KppParseError } from "../../../../../../packages/studio-format-gateway/src/kpp";
import {
  importKritaBundle,
  KritaBundleError,
  type KritaBundleImportResult,
} from "../../../../../../packages/studio-format-gateway/src/krita-bundle";
import { importMybBrush, MybParseError } from "../../../../../../packages/studio-format-gateway/src/myb";
import { STABILIZER_MAX } from "../studio-brush";

import {
  DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS,
  normalizeStudioBrushDynamicsSettings,
  type NormalizedStudioBrushDynamicsMapping,
  type NormalizedStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  createBrush,
  importBrushFromJson,
  type StudioBrushSnapshot,
  type StudioSavedBrush,
} from "./studio-brush-library";
import {
  STUDIO_BRUSH_PROGRAM_MAX_BYTES,
  STUDIO_EXTERNAL_BRUSH_PACK_MAX_BYTES,
} from "./studio-brush-pack-format";


import type {
  BrushLibraryBatchWriteSummary,
  BrushLibraryRepositoryPort,
} from "./studio-brush-library-repository";
import type { StudioBrushPackFormat } from "./studio-brush-pack-format";
import type { FormatIssue } from "../../../../../../packages/studio-format-gateway/src/format-common";
import type {
  BrushProgramIR,
  DynamicMappingIR,
} from "@toonspectrum/studio-project-model";

export {
  STUDIO_BRUSH_PACK_ACCEPT,
  STUDIO_BRUSH_PROGRAM_MAX_BYTES,
  STUDIO_EXTERNAL_BRUSH_PACK_MAX_BYTES,
  studioBrushPackFormatOf,
  type StudioBrushPackFormat,
} from "./studio-brush-pack-format";

/** Krita's stock UI diameter cap — the same reference `kpp.ts` normalizes against. */
export const KRITA_REFERENCE_MAX_DIAMETER_PX = 1000;

/** libmypaint stores `radius_logarithmic`; `myb.ts` divides the LUT by this. */
export const MYPAINT_LOG_RADIUS_SCALE = 6;

/** UI slider bounds, mirrored so an import can never produce an unreachable value. */
const MIN_STROKE_WIDTH = 1;
const MAX_STROKE_WIDTH = 80;
const MIN_OPACITY = 0.05;

export class StudioBrushProgramImportError extends Error {
  constructor(
    message: string,
    readonly format: "myb" | "kpp" | "sut" | "sutg" | "bundle",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioBrushProgramImportError";
  }
}

export interface StudioBrushPackCandidate {
  readonly name: string;
  readonly snapshot: StudioBrushSnapshot;
  /** Stable source path for multi-resource bundles. */
  readonly sourcePath?: string;
  readonly tags?: readonly string[];
}

export interface StudioBrushPackRights {
  readonly authors: readonly string[];
  readonly licenses: readonly string[];
  readonly websites: readonly string[];
  readonly emails: readonly string[];
  readonly tags: readonly string[];
}

export interface StudioBrushPackPreservation {
  readonly status: "drawable" | "structured-partial" | "preserve-only";
  readonly sourceFormat: string;
  readonly originalBytesUnmodified: true;
  /** FormatGateway holds the original bytes in its sourcePayload for this result. */
  readonly sourcePayloadAvailable: boolean;
}

export interface StudioBrushPackImportResult {
  readonly format: StudioBrushPackFormat;
  readonly brushes: readonly StudioBrushPackCandidate[];
  /**
   * Source fields with no drawable counterpart. Shown to the artist verbatim —
   * this is the honest half of "the brush imported".
   */
  readonly unmapped: readonly string[];
  /** Approximations and parser notes worth reading before drawing. */
  readonly warnings: readonly string[];
  /** Structured unsupported ledger; never collapsed into a false success. */
  readonly unsupported?: readonly FormatIssue[];
  readonly rights?: StudioBrushPackRights;
  readonly preservation?: StudioBrushPackPreservation;
}

export interface StudioBrushPackCommitResult {
  readonly result: StudioBrushPackImportResult;
  readonly materialized: readonly StudioSavedBrush[];
  readonly saved: BrushLibraryBatchWriteSummary;
}

export class StudioBrushPackPreserveOnlyError extends Error {
  constructor(readonly result: StudioBrushPackImportResult) {
    const firstReason = result.unsupported?.[0];
    super(
      `원본 바이트는 변경하지 않고 보존 판정했지만 실제로 그릴 수 있는 브러시가 0개라 SQLite 카탈로그에는 저장하지 않았어요.${firstReason ? ` ${firstReason.message}` : ""}`,
    );
    this.name = "StudioBrushPackPreserveOnlyError";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

// ---------------------------------------------------------------------------
// BrushProgramIR → StudioBrushSnapshot
// ---------------------------------------------------------------------------

function mappingsOf(
  dynamics: readonly DynamicMappingIR[],
  input: DynamicMappingIR["input"],
): DynamicMappingIR[] {
  return dynamics.filter((mapping) => mapping.input === input);
}

/** A constant mapping's single value; `kpp.ts` writes `[v, v]`. */
function constantValue(mapping: DynamicMappingIR): number {
  return mapping.curve[0] ?? 0;
}

function lutRange(mappings: readonly DynamicMappingIR[]): { low: number; high: number } | null {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const mapping of mappings) {
    for (const tap of mapping.curve) {
      if (!Number.isFinite(tap)) continue;
      low = Math.min(low, tap);
      high = Math.max(high, tap);
    }
  }
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null;
}

/**
 * A LUT is only faithful when it is (near) linear: the snapshot mapping is a
 * `from → to` ramp with a gamma, not an arbitrary table. The residual against
 * the best straight line is what decides whether the artist is told.
 */
function lutLinearityError(mapping: DynamicMappingIR): number {
  const taps = mapping.curve;
  const first = taps[0];
  const last = taps[taps.length - 1];
  if (first === undefined || last === undefined || taps.length < 3) return 0;
  const span = last - first;
  let worst = 0;
  for (let index = 1; index < taps.length - 1; index += 1) {
    const t = index / (taps.length - 1);
    const expected = first + span * t;
    worst = Math.max(worst, Math.abs((taps[index] ?? expected) - expected));
  }
  return worst;
}

const LUT_LINEARITY_TOLERANCE = 0.02;

interface SizeResolution {
  strokeWidth: number;
  /** Fraction of the full width kept at zero pressure (0 = full taper). */
  pressureMinRatio: number;
  hasPressure: boolean;
}

/**
 * Base width, in the units the pen slider uses.
 *
 * Krita lane: a constant mapping holds `diameter / 1000`. Multiple constants
 * multiply, matching `kpp.ts`'s "constants multiply through the chain".
 * libmypaint lane: the pressure LUT holds `radius_logarithmic / 6`, so the
 * widest dab is `2 · exp(maxTap · 6)`.
 */
function resolveSize(sizeDynamics: readonly DynamicMappingIR[]): SizeResolution {
  const constants = mappingsOf(sizeDynamics, "constant");
  const pressures = mappingsOf(sizeDynamics, "pressure");
  const pressureRange = lutRange(pressures);

  if (constants.length > 0) {
    const fraction = constants.reduce((product, mapping) => product * constantValue(mapping), 1);
    const strokeWidth = clamp(
      Math.round(fraction * KRITA_REFERENCE_MAX_DIAMETER_PX),
      MIN_STROKE_WIDTH,
      MAX_STROKE_WIDTH,
    );
    // A Krita size sensor is already a 0..1 multiplier on the diameter.
    return {
      strokeWidth,
      pressureMinRatio: pressureRange ? clamp(pressureRange.low, 0, 1) : 0,
      hasPressure: pressures.length > 0,
    };
  }

  if (pressureRange) {
    const widest = 2 * Math.exp(pressureRange.high * MYPAINT_LOG_RADIUS_SCALE);
    const narrowest = 2 * Math.exp(pressureRange.low * MYPAINT_LOG_RADIUS_SCALE);
    const strokeWidth = clamp(Math.round(widest), MIN_STROKE_WIDTH, MAX_STROKE_WIDTH);
    return {
      strokeWidth,
      pressureMinRatio: widest > 0 ? clamp(narrowest / widest, 0, 1) : 0,
      hasPressure: true,
    };
  }

  return {
    strokeWidth: DEFAULT_STUDIO_BRUSH_SNAPSHOT.strokeWidth,
    pressureMinRatio: 0,
    hasPressure: false,
  };
}

interface FlowResolution {
  opacity: number;
  pressureMinRatio: number;
  hasPressure: boolean;
}

/** Constant flow/opacity params multiply; the pressure LUT rides on top. */
function resolveFlow(flowDynamics: readonly DynamicMappingIR[]): FlowResolution {
  const constants = mappingsOf(flowDynamics, "constant");
  const pressures = mappingsOf(flowDynamics, "pressure");
  const pressureRange = lutRange(pressures);
  const constantFactor = constants.reduce(
    (product, mapping) => product * constantValue(mapping),
    1,
  );
  const peak = pressureRange ? pressureRange.high : 1;
  const opacity = clamp(constantFactor * peak, MIN_OPACITY, 1);
  return {
    opacity,
    pressureMinRatio:
      pressureRange && pressureRange.high > 0
        ? clamp(pressureRange.low / pressureRange.high, 0, 1)
        : 0,
    hasPressure: pressures.length > 0,
  };
}

function pressureRamp(from: number): NormalizedStudioBrushDynamicsMapping {
  return {
    source: "pressure",
    mode: "multiply",
    from: clamp(from, 0, 1),
    to: 1,
    amount: 1,
    curve: 1,
    invert: false,
  };
}

function tipSettingsFor(
  hardness: number,
): NormalizedStudioBrushDynamicsSettings["tip"] {
  const clamped = clamp(hardness, 0, 1);
  return {
    shape: clamped > 0.78 ? "hard" : clamped < 0.28 ? "soft" : "round",
    softness: 1 - clamped,
    alphaMapBase64: null,
    alphaMapSize: DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.tip.alphaMapSize,
  };
}

/** Deterministic per-name seed so re-importing the same file replays identically. */
function stableSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    hash ^= value.charCodeAt(cursor);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface StudioBrushProgramSnapshotResult {
  readonly snapshot: StudioBrushSnapshot;
  /** IR fields this map cannot carry into a drawable setting. */
  readonly unmapped: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Maps a parsed brush program onto the snapshot the pen actually draws with.
 *
 * Anything the snapshot has no slot for (mixing/smudge, mesh geometry, raster
 * output policy, image tips, angle jitter) is reported rather than approximated
 * into something that would draw wrong.
 */
export function studioBrushSnapshotFromProgram(
  program: BrushProgramIR,
): StudioBrushProgramSnapshotResult {
  const unmapped: string[] = [];
  const warnings: string[] = [];

  const size = resolveSize(program.sizeDynamics);
  const flow = resolveFlow(program.flowDynamics);

  for (const mapping of program.sizeDynamics) {
    if (mapping.input !== "pressure" && mapping.input !== "constant") {
      unmapped.push(`sizeDynamics(${mapping.input})`);
    } else if (lutLinearityError(mapping) > LUT_LINEARITY_TOLERANCE) {
      warnings.push(
        `굵기 필압 곡선이 곡선형이라 최소~최대 구간의 직선 근사로 옮겼어요(${mapping.input}).`,
      );
    }
  }
  for (const mapping of program.flowDynamics) {
    if (mapping.input !== "pressure" && mapping.input !== "constant") {
      unmapped.push(`flowDynamics(${mapping.input})`);
    } else if (lutLinearityError(mapping) > LUT_LINEARITY_TOLERANCE) {
      warnings.push(
        `농도 필압 곡선이 곡선형이라 최소~최대 구간의 직선 근사로 옮겼어요(${mapping.input}).`,
      );
    }
  }

  if (program.tip.kind === "image") {
    unmapped.push("tip.image");
    warnings.push("이미지 펜촉은 아직 옮기지 못해 원형 촉으로 그려요.");
  } else if (program.tip.kind === "stamp") {
    warnings.push("스탬프 촉은 절차적 원형 촉의 경도로 근사했어요.");
  }
  if (program.tip.angleJitterDeg > 0) unmapped.push("tip.angleJitterDeg");
  if (program.mixing.kind !== "none") {
    unmapped.push(`mixing.${program.mixing.kind}`);
    warnings.push("번짐·습식 혼합은 아직 그리기에 반영되지 않아요.");
  }
  if (program.geometry.kind !== "perfect-freehand") {
    unmapped.push(`geometry.${program.geometry.kind}`);
  }
  if (program.output.target !== "vector-path") unmapped.push(`output.${program.output.target}`);
  if (!size.hasPressure && program.sizeDynamics.length === 0) {
    warnings.push("원본에 굵기 필압 정보가 없어 기본 굵기로 등록했어요.");
  }

  const dynamics = normalizeStudioBrushDynamicsSettings({
    ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS,
    seed: stableSeed(program.id),
    // IR spacing is a percentage of the tip width; the studio stores a ratio.
    spacingRatio: clamp(program.tip.spacingPct / 100, 0.01, 16),
    tip: tipSettingsFor(program.tip.hardness),
    width: {
      ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.width,
      base: size.strokeWidth,
      mappings: size.hasPressure ? [pressureRamp(size.pressureMinRatio)] : [],
    },
    opacity: {
      ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.opacity,
      base: flow.opacity,
      mappings: flow.hasPressure ? [pressureRamp(flow.pressureMinRatio)] : [],
    },
    flow: {
      ...DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.flow,
      base: flow.opacity,
      mappings: flow.hasPressure ? [pressureRamp(flow.pressureMinRatio)] : [],
    },
  });

  const snapshot: StudioBrushSnapshot = {
    ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
    // The dynamics-driven family: it is the one that reads every field above.
    brushId: "ink-particle",
    sourcePresetId: program.id,
    sourcePresetName: program.name,
    strokeWidth: size.strokeWidth,
    brushOpacity: flow.opacity,
    pressureMinSize: size.pressureMinRatio,
    stabilizer: Math.round(clamp(program.stabilizer.strength, 0, 1) * STABILIZER_MAX),
    brushDynamics: dynamics,
  };

  return {
    snapshot,
    unmapped: [...new Set(unmapped)].sort(),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// File lanes
// ---------------------------------------------------------------------------

function presetDisplayName(rawName: string, fileName: string): string {
  const trimmed = rawName.trim();
  if (trimmed) return trimmed;
  const stem = fileName.replace(/\.[^.]+$/u, "").trim();
  return stem || "가져온 브러시";
}

function issueText(issue: FormatIssue): string {
  return `${issue.path ? `${issue.path}: ` : ""}${issue.message} [${issue.code}]`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function cspRights(result: CspToolFileImportResult): StudioBrushPackRights {
  return {
    authors: result.rights.authors,
    licenses: result.rights.licenses,
    websites: result.rights.websites,
    emails: result.rights.emails,
    tags: [],
  };
}

function kritaRights(result: KritaBundleImportResult): StudioBrushPackRights {
  return {
    authors: uniqueStrings([
      result.rights.author ?? "",
      result.rights.creator ?? "",
      result.rights.initialCreator ?? "",
    ]),
    licenses: uniqueStrings([result.rights.license ?? ""]),
    websites: uniqueStrings([result.rights.website ?? ""]),
    emails: uniqueStrings([result.rights.email ?? ""]),
    tags: result.rights.tags,
  };
}

/** Verified clean-room SUT/SUTG subset → drawable Studio snapshots. */
export async function importStudioCspToolBytes(
  bytes: Uint8Array,
  fileName: string,
  kind: "sut" | "sutg",
  sqliteReader?: CspSutSqliteReader,
  signal?: AbortSignal,
): Promise<StudioBrushPackImportResult> {
  let parsed: CspToolFileImportResult;
  try {
    parsed = await importCspToolFile(bytes, { kind, sqliteReader, signal });
  } catch (cause) {
    if (cause instanceof CspToolFileError) {
      throw new StudioBrushProgramImportError(
        `Clip Studio ${kind.toUpperCase()} 파일을 읽지 못했어요. ${cause.message}`,
        kind,
        { cause },
      );
    }
    throw cause;
  }
  const mapped = parsed.programs.map((program) => ({
    program,
    mapped: studioBrushSnapshotFromProgram(program),
  }));
  return {
    format: kind,
    brushes: mapped.map(({ program, mapped: lowered }) => ({
      name: presetDisplayName(program.name, fileName),
      snapshot: {
        ...lowered.snapshot,
        sourcePresetName: presetDisplayName(program.name, fileName),
      },
    })),
    unmapped: mapped.flatMap(({ program, mapped: lowered }) =>
      lowered.unmapped.map((field) => `${program.name}:${field}`)),
    warnings: [
      ...parsed.warnings.map(issueText),
      ...mapped.flatMap(({ program, mapped: lowered }) =>
        lowered.warnings.map((message) => `${program.name}: ${message}`)),
    ],
    unsupported: parsed.unsupported,
    rights: cspRights(parsed),
    preservation: {
      status: parsed.supportLevel,
      sourceFormat: parsed.sourcePayload.format,
      originalBytesUnmodified: true,
      sourcePayloadAvailable: parsed.sourcePayload.base64.length > 0,
    },
  };
}

/** Krita `.bundle` KPP/MYB resources → one candidate per verified program. */
export async function importStudioKritaBundleBytes(
  bytes: Uint8Array,
  options: Parameters<typeof importKritaBundle>[1] = {},
): Promise<StudioBrushPackImportResult> {
  let parsed: KritaBundleImportResult;
  try {
    parsed = await importKritaBundle(bytes, options);
  } catch (cause) {
    if (cause instanceof KritaBundleError) {
      throw new StudioBrushProgramImportError(
        `Krita 브러시 번들(.bundle)을 읽지 못했어요. ${cause.message}`,
        "bundle",
        { cause },
      );
    }
    throw cause;
  }
  const mapped = parsed.brushes.map((brush) => ({
    brush,
    mapped: studioBrushSnapshotFromProgram(brush.program),
  }));
  return {
    format: "bundle",
    brushes: mapped.map(({ brush, mapped: lowered }) => ({
      name: presetDisplayName(brush.program.name, brush.path),
      snapshot: {
        ...lowered.snapshot,
        sourcePresetName: presetDisplayName(brush.program.name, brush.path),
      },
      sourcePath: brush.path,
      tags: brush.tags,
    })),
    unmapped: mapped.flatMap(({ brush, mapped: lowered }) =>
      lowered.unmapped.map((field) => `${brush.path}:${field}`)),
    warnings: [
      ...parsed.warnings.map(issueText),
      ...mapped.flatMap(({ brush, mapped: lowered }) =>
        lowered.warnings.map((message) => `${brush.path}: ${message}`)),
    ],
    unsupported: parsed.unsupported,
    rights: kritaRights(parsed),
    preservation: {
      status: parsed.brushes.length > 0 ? "structured-partial" : "preserve-only",
      sourceFormat: parsed.sourcePayload.format,
      originalBytesUnmodified: true,
      sourcePayloadAvailable: parsed.sourcePayload.base64.length > 0,
    },
  };
}

/** libmypaint `.myb` v3 → one drawable brush. */
export function importStudioMybBytes(
  bytes: Uint8Array,
  fileName: string,
): StudioBrushPackImportResult {
  const presetId = `myb:${fileName}`;
  let parsed;
  try {
    parsed = importMybBrush(bytes, presetId, presetDisplayName("", fileName));
  } catch (error) {
    if (error instanceof MybParseError) {
      throw new StudioBrushProgramImportError(
        `libmypaint 브러시(.myb)를 읽지 못했어요. ${error.message}`,
        "myb",
        { cause: error },
      );
    }
    throw error;
  }
  const name = presetDisplayName(
    parsed.document.description ?? parsed.document.comment ?? "",
    fileName,
  );
  const mapped = studioBrushSnapshotFromProgram(parsed.preset);
  return {
    format: "myb",
    brushes: [
      {
        name,
        snapshot: { ...mapped.snapshot, sourcePresetName: name },
      },
    ],
    unmapped: [
      ...mapped.unmapped,
      ...parsed.unmappedSettings.map((setting) => `myb:${setting}`),
    ].sort(),
    warnings: mapped.warnings,
  };
}

/** Krita `.kpp` → one drawable brush, or a loud refusal. */
export function importStudioKppBytes(
  bytes: Uint8Array,
  fileName: string,
): StudioBrushPackImportResult {
  let parsed;
  try {
    parsed = parseKppPreset(bytes);
  } catch (error) {
    if (error instanceof KppParseError) {
      throw new StudioBrushProgramImportError(
        `Krita 브러시(.kpp)를 읽지 못했어요. ${error.message}`,
        "kpp",
        { cause: error },
      );
    }
    throw error;
  }
  const name = presetDisplayName(parsed.presetName, fileName);
  const mapped = studioBrushSnapshotFromProgram(parsed.program);
  const warnings = [...mapped.warnings, ...parsed.warnings];
  if (parsed.program.providerPreference.length === 0) {
    // The gateway produces a shell for paintops with no mapping lane. Registering
    // it silently would be the "imported but draws nothing like it" failure.
    warnings.push(
      "이 Krita 엔진은 아직 대응 브러시가 없어 기본 잉크 입자 브러시 설정으로 등록했어요.",
    );
  }
  return {
    format: "kpp",
    brushes: [{ name, snapshot: { ...mapped.snapshot, sourcePresetName: name } }],
    unmapped: [
      ...mapped.unmapped,
      ...parsed.unmapped.map((entry) => `kpp:${entry}`),
    ].sort(),
    warnings,
  };
}

/** App-private `.json` — reuses the existing validator, reported in one shape. */
export function importStudioBrushJsonText(
  text: string,
  fileName: string,
): StudioBrushPackImportResult {
  const fallbackName = fileName.replace(/\.json$/iu, "");
  const { brush, adjustedFields } = importBrushFromJson(text, fallbackName);
  return {
    format: "json",
    brushes: [{ name: brush.name, snapshot: brush }],
    unmapped: [],
    warnings:
      adjustedFields.length > 0
        ? [`일부 값(${adjustedFields.join(", ")})은 안전 범위로 보정했어요.`]
        : [],
  };
}

export interface StudioBrushProgramFileOptions {
  readonly signal?: AbortSignal;
  readonly cspSqliteReader?: CspSutSqliteReader;
  readonly kritaBundleOptions?: Parameters<typeof importKritaBundle>[1];
}

/** Reads every engine-neutral program lane; ABR/JSON retain their dedicated owners. */
export async function importStudioBrushProgramFile(
  file: File,
  format: "myb" | "kpp" | "sut" | "sutg" | "bundle",
  options: StudioBrushProgramFileOptions = {},
): Promise<StudioBrushPackImportResult> {
  const maximumBytes = format === "sut" || format === "sutg" || format === "bundle"
    ? STUDIO_EXTERNAL_BRUSH_PACK_MAX_BYTES
    : STUDIO_BRUSH_PROGRAM_MAX_BYTES;
  if (file.size > maximumBytes) {
    throw new StudioBrushProgramImportError(
      `브러시 파일이 너무 커요. ${Math.round(maximumBytes / 1_000_000)}MB 이하 파일만 가져올 수 있어요.`,
      format,
    );
  }
  if (options.signal?.aborted) {
    throw new StudioBrushProgramImportError("브러시 가져오기가 취소되었습니다.", format);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (options.signal?.aborted) {
    throw new StudioBrushProgramImportError("브러시 가져오기가 취소되었습니다.", format);
  }
  if (format === "myb") return importStudioMybBytes(bytes, file.name);
  if (format === "kpp") return importStudioKppBytes(bytes, file.name);
  if (format === "bundle") {
    return importStudioKritaBundleBytes(bytes, {
      ...options.kritaBundleOptions,
      signal: options.signal,
    });
  }
  const sqliteReader = options.cspSqliteReader
    ?? (await import("../studio-csp-sut-sqlite-reader-client"))
      .createBrowserCspSutSqliteReader();
  return importStudioCspToolBytes(bytes, file.name, format, sqliteReader, options.signal);
}

export function studioBrushPackFormatLabel(format: StudioBrushPackFormat): string {
  switch (format) {
    case "myb": return "libmypaint";
    case "kpp": return "Krita";
    case "bundle": return "Krita 번들";
    case "sut": return "Clip Studio SUT";
    case "sutg": return "Clip Studio SUTG";
    case "abr": return "Photoshop ABR";
    case "json": return "Studio JSON";
  }
}

function displayList(label: string, values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const shown = values.slice(0, 4);
  const remainder = values.length - shown.length;
  return `${label}: ${shown.join(", ")}${remainder > 0 ? ` 외 ${remainder}개` : ""}.`;
}

/** Compact but explicit UI ledger for approximations, unsupported fields and rights. */
export function studioBrushPackImportNotes(result: StudioBrushPackImportResult): string[] {
  const notes = [...result.warnings];
  const unmapped = displayList("옮기지 못한 전용 설정", result.unmapped);
  if (unmapped) notes.push(unmapped);
  const unsupported = result.unsupported ?? [];
  const unsupportedSummary = displayList(
    `미지원 항목 ${unsupported.length}개`,
    unsupported.map(issueText),
  );
  if (unsupportedSummary) notes.push(unsupportedSummary);
  const rights = result.rights;
  if (rights) {
    const parts = [
      displayList("제작자", rights.authors),
      displayList("라이선스", rights.licenses),
      displayList("웹사이트", rights.websites),
      displayList("연락처", rights.emails),
      displayList("태그", rights.tags),
    ].filter((value): value is string => value !== null);
    if (parts.length > 0) notes.push(`권리 정보 — ${parts.join(" ")}`);
  }
  if (result.preservation?.originalBytesUnmodified) {
    notes.push("원본 파일 바이트는 수정하지 않았어요.");
  }
  return uniqueStrings(notes);
}

/**
 * Sole commit boundary for MYB/KPP/SUT/SUTG/Krita bundle programs. It refuses
 * preserve-only results and writes every materialized brush in one SQLite
 * repository batch.
 */
export async function commitStudioBrushPackImport(
  result: StudioBrushPackImportResult,
  repository: BrushLibraryRepositoryPort,
): Promise<StudioBrushPackCommitResult> {
  if (result.brushes.length === 0) throw new StudioBrushPackPreserveOnlyError(result);
  const materialized = result.brushes.map((candidate) =>
    createBrush(candidate.name, candidate.snapshot));
  const saved = await repository.putMany(materialized);
  return { result, materialized, saved };
}

export async function importAndCommitStudioBrushProgramFile(
  file: File,
  format: "myb" | "kpp" | "sut" | "sutg" | "bundle",
  repository: BrushLibraryRepositoryPort,
  options: StudioBrushProgramFileOptions = {},
): Promise<StudioBrushPackCommitResult> {
  const result = await importStudioBrushProgramFile(file, format, options);
  return commitStudioBrushPackImport(result, repository);
}
