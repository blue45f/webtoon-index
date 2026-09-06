import { BRUSH_PRESETS } from "../studio-brush";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsEqual,
} from "./studio-brush-dynamics";
import {
  STUDIO_BRUSH_OIL_PROGRAM_KEYS,
  type StudioBrushEngineProgramSet,
} from "./studio-brush-engine-program-set";
import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  type StudioBrushSnapshot,
  type StudioBrushStampTuning,
  type StudioSavedBrush,
} from "./studio-brush-library";
import { studioCoreBrushCatalogSelection } from "./studio-brush-selection";
import {
  resolveStudioStampBrushKind,
  STUDIO_STAMP_BRUSH_DEFAULTS,
} from "./studio-brush-stamp-engine";


import type { StudioBrushCatalogSelection } from "./studio-brush-selection";

export const STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS = [
  "strokeWidth",
  "brushOpacity",
  "brushDynamics",
  "stampTuning",
  "enginePrograms",
  "stabilizer",
  "stabilizerMode",
  "postCorrection",
  "preserveCorners",
  "pressureCurve",
  "pressureMinSize",
  "useVelocityPressure",
  "velocitySensitivity",
  "tiltEnabled",
  "tipAngle",
  "tipRoundness",
] as const;

export type StudioBrushDefaultRestoreField =
  (typeof STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS)[number];

export type StudioBrushDefaultRestoreDirection = "redo" | "undo";

export type StudioBrushDefaultRestoreValues = Readonly<
  Pick<StudioBrushSnapshot, StudioBrushDefaultRestoreField>
>;

export interface StudioBrushDefaultRestoreProfile {
  readonly source: "built-in" | "saved";
  readonly sourceId: string;
  readonly sourceName: string;
  readonly values: StudioBrushDefaultRestoreValues;
}

export interface StudioBrushDefaultRestoreChange {
  readonly field: StudioBrushDefaultRestoreField;
  readonly label: string;
}

/**
 * One explicit state transition for every setting that changes the selected brush's feel.
 *
 * `after` is the atomic restore payload. Callers that keep a single reducer can replace it in one
 * update; callers with legacy split React state can apply every value in one event (React batches
 * those updates). `before` is intentionally complete so the same callback can implement a safe
 * one-step undo without trying to reverse individual sliders.
 */
export interface StudioBrushDefaultRestoreTransaction {
  readonly profile: StudioBrushDefaultRestoreProfile;
  readonly before: StudioBrushDefaultRestoreValues;
  readonly after: StudioBrushDefaultRestoreValues;
  readonly changes: readonly StudioBrushDefaultRestoreChange[];
  readonly summary: string;
}

const FIELD_LABELS: Readonly<Record<StudioBrushDefaultRestoreField, string>> = Object.freeze({
  strokeWidth: "굵기",
  brushOpacity: "불투명도",
  brushDynamics: "브러시 반응·질감",
  stampTuning: "스탬프 도포",
  enginePrograms: "엔진 조합",
  stabilizer: "손떨림 보정",
  stabilizerMode: "보정 방식",
  postCorrection: "후보정",
  preserveCorners: "각점 보존",
  pressureCurve: "필압 곡선",
  pressureMinSize: "최소 굵기",
  useVelocityPressure: "속도 압력",
  velocitySensitivity: "속도 민감도",
  tiltEnabled: "기울기",
  tipAngle: "촉 각도",
  tipRoundness: "촉 원형도",
});

function cloneStampTuning(
  tuning: StudioBrushStampTuning | null,
): StudioBrushStampTuning | null {
  return tuning
    ? {
        flow: tuning.flow,
        hardness: tuning.hardness,
        minSize: tuning.minSize,
      }
    : null;
}

function defaultStampTuning(brushId: string): StudioBrushStampTuning | null {
  const kind = resolveStudioStampBrushKind(brushId);
  if (!kind) return null;
  const defaults = STUDIO_STAMP_BRUSH_DEFAULTS[kind];
  return {
    flow: defaults.flow,
    hardness: defaults.hardness,
    minSize: defaults.minSizeRatio,
  };
}

export function studioBrushDefaultRestoreValuesFromSnapshot(
  snapshot: StudioBrushSnapshot,
): StudioBrushDefaultRestoreValues {
  return {
    strokeWidth: snapshot.strokeWidth,
    brushOpacity: snapshot.brushOpacity,
    brushDynamics: normalizeStudioBrushDynamicsSettings(snapshot.brushDynamics),
    stampTuning: cloneStampTuning(snapshot.stampTuning),
    enginePrograms: snapshot.enginePrograms,
    stabilizer: snapshot.stabilizer,
    stabilizerMode: snapshot.stabilizerMode,
    postCorrection: snapshot.postCorrection,
    preserveCorners: snapshot.preserveCorners,
    pressureCurve: snapshot.pressureCurve,
    pressureMinSize: snapshot.pressureMinSize,
    useVelocityPressure: snapshot.useVelocityPressure,
    velocitySensitivity: snapshot.velocitySensitivity,
    tiltEnabled: snapshot.tiltEnabled,
    tipAngle: snapshot.tipAngle,
    tipRoundness: snapshot.tipRoundness,
  };
}

/**
 * Built-in defaults deliberately preserve the active color and catalogue identity.
 *
 * Width, opacity and dynamics come from the exact catalogue entry. Input correction uses the
 * low-latency neutral profile shared by newly created brushes. Stamp renderers additionally restore
 * their own flow/hardness/min-size defaults.
 */
export function createStudioBuiltInBrushDefaultRestoreProfile(
  selection: StudioBrushCatalogSelection,
): StudioBrushDefaultRestoreProfile {
  const neutral = DEFAULT_STUDIO_BRUSH_SNAPSHOT;
  return {
    source: "built-in",
    sourceId: selection.catalogId,
    sourceName: selection.catalogName,
    values: {
      strokeWidth: selection.defaultWidth,
      brushOpacity: selection.defaultOpacity,
      brushDynamics: normalizeStudioBrushDynamicsSettings(
        selection.brushDynamics ?? neutral.brushDynamics,
      ),
      stampTuning: defaultStampTuning(selection.runtimeBrushId),
      // 기본값 복원은 브러시 id 의 조합으로 되돌린다 = 세트를 벗는다.
      enginePrograms: null,
      stabilizer: neutral.stabilizer,
      stabilizerMode: neutral.stabilizerMode,
      postCorrection: neutral.postCorrection,
      preserveCorners: neutral.preserveCorners,
      pressureCurve: neutral.pressureCurve,
      pressureMinSize: neutral.pressureMinSize,
      useVelocityPressure: neutral.useVelocityPressure,
      velocitySensitivity: neutral.velocitySensitivity,
      tiltEnabled: neutral.tiltEnabled,
      tipAngle: neutral.tipAngle,
      tipRoundness: neutral.tipRoundness,
    },
  };
}

export function resolveStudioCoreBrushDefaultRestoreProfile(
  brushId: string,
): StudioBrushDefaultRestoreProfile | null {
  const preset = BRUSH_PRESETS.find((candidate) => candidate.id === brushId);
  return preset
    ? createStudioBuiltInBrushDefaultRestoreProfile(
        studioCoreBrushCatalogSelection(preset),
      )
    : null;
}

/**
 * A user brush never guesses a new baseline. Its own persisted snapshot is the only safe reset
 * source; if the UI cannot provide that snapshot it must offer re-apply from the brush library
 * instead of silently falling back to an unrelated built-in preset.
 */
export function createStudioSavedBrushDefaultRestoreProfile(
  brush: StudioSavedBrush,
): StudioBrushDefaultRestoreProfile {
  return {
    source: "saved",
    sourceId: brush.id,
    sourceName: brush.name,
    values: studioBrushDefaultRestoreValuesFromSnapshot(brush),
  };
}

function stampTuningEqual(
  left: StudioBrushStampTuning | null,
  right: StudioBrushStampTuning | null,
): boolean {
  return left === right
    || (
      left !== null
      && right !== null
      && left.flow === right.flow
      && left.hardness === right.hardness
      && left.minSize === right.minSize
    );
}

/**
 * 조합은 값 비교여야 한다. 참조 비교면 같은 조합을 다시 만들었을 뿐인 브러시가 "변경됨"으로
 * 보이고, 기본값 복원 버튼이 아무것도 되돌릴 게 없는데도 계속 떠 있게 된다.
 */
function studioBrushEngineProgramSetsEqual(
  left: StudioBrushEngineProgramSet | null,
  right: StudioBrushEngineProgramSet | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.version !== right.version) return false;
  if (!left.oil || !right.oil) return left.oil === right.oil;
  return STUDIO_BRUSH_OIL_PROGRAM_KEYS.every((key) => left.oil![key] === right.oil![key]);
}

function fieldEqual(
  field: StudioBrushDefaultRestoreField,
  left: StudioBrushDefaultRestoreValues,
  right: StudioBrushDefaultRestoreValues,
): boolean {
  if (field === "brushDynamics") {
    return studioBrushDynamicsSettingsEqual(left.brushDynamics, right.brushDynamics);
  }
  if (field === "stampTuning") {
    return stampTuningEqual(left.stampTuning, right.stampTuning);
  }
  if (field === "enginePrograms") {
    return studioBrushEngineProgramSetsEqual(left.enginePrograms, right.enginePrograms);
  }
  return left[field] === right[field];
}

export function studioBrushDefaultRestoreValuesEqual(
  left: StudioBrushDefaultRestoreValues,
  right: StudioBrushDefaultRestoreValues,
): boolean {
  return STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS.every((field) =>
    fieldEqual(field, left, right)
  );
}

function summarizeChanges(changes: readonly StudioBrushDefaultRestoreChange[]): string {
  if (changes.length === 0) return "이미 이 브러시의 기본값입니다.";
  const visible = changes.slice(0, 3).map(({ label }) => label).join(" · ");
  const remaining = changes.length - 3;
  return remaining > 0 ? `${visible} 외 ${remaining}개` : visible;
}

export function planStudioBrushDefaultRestore(
  current: StudioBrushSnapshot,
  profile: StudioBrushDefaultRestoreProfile,
): StudioBrushDefaultRestoreTransaction {
  const before = studioBrushDefaultRestoreValuesFromSnapshot(current);
  const after = studioBrushDefaultRestoreValuesFromSnapshot({
    ...current,
    ...profile.values,
  });
  const changes = STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS
    .filter((field) => !fieldEqual(field, before, after))
    .map((field) => Object.freeze({ field, label: FIELD_LABELS[field] }));
  return Object.freeze({
    profile,
    before: Object.freeze(before),
    after: Object.freeze(after),
    changes: Object.freeze(changes),
    summary: summarizeChanges(changes),
  });
}

export function studioBrushSnapshotForDefaultRestore(
  current: StudioBrushSnapshot,
  transaction: StudioBrushDefaultRestoreTransaction,
  direction: StudioBrushDefaultRestoreDirection,
): StudioBrushSnapshot {
  const values = direction === "undo" ? transaction.before : transaction.after;
  return {
    ...current,
    ...values,
    // Identity and color are outside the reset contract. Keep them explicit so future additions to
    // StudioBrushSnapshot cannot accidentally turn a brush reset into a brush switch.
    brushId: current.brushId,
    sourcePresetId: current.sourcePresetId,
    sourcePresetName: current.sourcePresetName,
    color: current.color,
    brushDynamics: normalizeStudioBrushDynamicsSettings(values.brushDynamics),
    stampTuning: cloneStampTuning(values.stampTuning),
  };
}
