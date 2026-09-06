import {
  createStudioBuiltInBrushDefaultRestoreProfile,
  createStudioSavedBrushDefaultRestoreProfile,
  planStudioBrushDefaultRestore,
  STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS,
  studioBrushDefaultRestoreValuesEqual,
  type StudioBrushDefaultRestoreField,
  type StudioBrushDefaultRestoreProfile,
  type StudioBrushDefaultRestoreTransaction,
} from "./studio-brush-default-restore";

import type {
  StudioBrushSnapshot,
  StudioSavedBrush,
} from "./studio-brush-library";
import type { StudioBrushCatalogSelection } from "./studio-brush-selection";

/**
 * Fields that belong to the live drawing session rather than a brush-feel baseline.
 *
 * Color is deliberately artist state: choosing another drawing color must not make an otherwise
 * unchanged brush look modified or be overwritten by "기본값 복원". The other three fields identify
 * which renderer/catalogue entry owns the baseline and are validated separately before a restore
 * transaction is exposed.
 */
export const STUDIO_BRUSH_BASELINE_EXCLUDED_FIELDS = [
  "brushId",
  "sourcePresetId",
  "sourcePresetName",
  "color",
] as const satisfies readonly (keyof StudioBrushSnapshot)[];

export type StudioBrushBaselineExcludedField =
  (typeof STUDIO_BRUSH_BASELINE_EXCLUDED_FIELDS)[number];

type StudioBrushBaselineAccountedField =
  | StudioBrushDefaultRestoreField
  | StudioBrushBaselineExcludedField;

/**
 * Compile-time exhaustiveness gate. Adding a setting to StudioBrushSnapshot without explicitly
 * making it restorable or excluded turns this assignment into a TypeScript error.
 */
export const STUDIO_BRUSH_BASELINE_FIELD_CONTRACT_COMPLETE:
  Exclude<keyof StudioBrushSnapshot, StudioBrushBaselineAccountedField> extends never
    ? true
    : never = true;

export type StudioBrushBaselineKind = "core" | "extended" | "saved";

export interface StudioBrushBaselineIdentity {
  /** Stable selection key; settings edits never change it. */
  readonly key: `catalog:${string}` | `saved:${string}`;
  readonly kind: StudioBrushBaselineKind;
  /** Concrete renderer used by the canvas. */
  readonly runtimeBrushId: string;
  /** Extended catalogue identity captured in the live snapshot, or null for core brushes. */
  readonly sourcePresetId: string | null;
  /** Present only while the baseline is backed by a persisted user brush. */
  readonly savedBrushId: string | null;
}

export interface StudioBrushBaseline {
  readonly identity: StudioBrushBaselineIdentity;
  readonly profile: StudioBrushDefaultRestoreProfile;
}

export type StudioBrushBaselineSelection =
  | {
      readonly kind: "catalog";
      readonly selection: StudioBrushCatalogSelection;
    }
  | {
      readonly kind: "saved";
      readonly brush: StudioSavedBrush;
    };

export type StudioBrushBaselineAction =
  | {
      /**
       * A real catalogue/saved-brush selection replaces the previous baseline. Do not dispatch
       * this action for sliders, pressure curves, color changes, or other property edits.
       */
      readonly type: "brush-selected";
      readonly selection: StudioBrushBaselineSelection;
    }
  | {
      /** Unknown/imported selection without a verified profile must fail closed. */
      readonly type: "selection-invalidated";
    }
  | {
      /**
       * Reconcile an active saved baseline after localStorage/storage-event updates. Missing or
       * materially changed records invalidate the baseline instead of restoring stale values.
       */
      readonly type: "saved-library-reconciled";
      readonly brushes: readonly StudioSavedBrush[];
    };

export interface StudioBrushBaselineDirtyState {
  readonly status: "clean" | "modified";
  readonly baseline: StudioBrushBaseline;
  readonly transaction: StudioBrushDefaultRestoreTransaction;
  readonly dirtyFields: readonly StudioBrushDefaultRestoreField[];
  readonly dirtyLabels: readonly string[];
  readonly dirtyCount: number;
  readonly summary: string;
}

export interface StudioBrushBaselineInvalidState {
  readonly status: "invalid";
  readonly baseline: StudioBrushBaseline;
  readonly reason: "selection-changed";
  readonly transaction: null;
  readonly dirtyFields: readonly StudioBrushDefaultRestoreField[];
  readonly dirtyLabels: readonly string[];
  readonly dirtyCount: 0;
  readonly summary: string;
}

export type StudioBrushBaselineInspection =
  | StudioBrushBaselineDirtyState
  | StudioBrushBaselineInvalidState;

export interface StudioBrushBaselineInspectionOptions {
  /**
   * CLIP STUDIO-style property locks survive a preset reapply. Locked values are removed from the
   * visible modified count and copied from `before` into the atomic restore payload.
   */
  readonly preserveStrokeWidth?: boolean;
  readonly preserveBrushOpacity?: boolean;
}

function summarizeBaselineChanges(
  changes: StudioBrushDefaultRestoreTransaction["changes"],
): string {
  if (changes.length === 0) return "이미 이 브러시의 기본값입니다.";
  const visible = changes.slice(0, 3).map(({ label }) => label).join(" · ");
  const remaining = changes.length - 3;
  return remaining > 0 ? `${visible} 외 ${remaining}개` : visible;
}

function preserveLockedBrushFields(
  transaction: StudioBrushDefaultRestoreTransaction,
  options: StudioBrushBaselineInspectionOptions,
): StudioBrushDefaultRestoreTransaction {
  if (!options.preserveStrokeWidth && !options.preserveBrushOpacity) {
    return transaction;
  }
  const changes = Object.freeze(
    transaction.changes.filter(({ field }) =>
      !(options.preserveStrokeWidth && field === "strokeWidth")
      && !(options.preserveBrushOpacity && field === "brushOpacity")
    ),
  );
  const after = Object.freeze({
    ...transaction.after,
    ...(options.preserveStrokeWidth
      ? { strokeWidth: transaction.before.strokeWidth }
      : {}),
    ...(options.preserveBrushOpacity
      ? { brushOpacity: transaction.before.brushOpacity }
      : {}),
  });
  return Object.freeze({
    ...transaction,
    after,
    changes,
    summary: summarizeBaselineChanges(changes),
  });
}

function frozenIdentity(
  identity: StudioBrushBaselineIdentity,
): StudioBrushBaselineIdentity {
  return Object.freeze(identity);
}

export function createStudioCatalogBrushBaseline(
  selection: StudioBrushCatalogSelection,
): StudioBrushBaseline {
  const extended = selection.catalogId !== selection.runtimeBrushId;
  return Object.freeze({
    identity: frozenIdentity({
      key: `catalog:${selection.catalogId}`,
      kind: extended ? "extended" : "core",
      runtimeBrushId: selection.runtimeBrushId,
      sourcePresetId: extended ? selection.catalogId : null,
      savedBrushId: null,
    }),
    profile: createStudioBuiltInBrushDefaultRestoreProfile(selection),
  });
}

export function createStudioSavedBrushBaseline(
  brush: StudioSavedBrush,
): StudioBrushBaseline {
  return Object.freeze({
    identity: frozenIdentity({
      key: `saved:${brush.id}`,
      kind: "saved",
      runtimeBrushId: brush.brushId,
      sourcePresetId: brush.sourcePresetId ?? null,
      savedBrushId: brush.id,
    }),
    profile: createStudioSavedBrushDefaultRestoreProfile(brush),
  });
}

export function createStudioBrushBaseline(
  selection: StudioBrushBaselineSelection,
): StudioBrushBaseline {
  return selection.kind === "saved"
    ? createStudioSavedBrushBaseline(selection.brush)
    : createStudioCatalogBrushBaseline(selection.selection);
}

/**
 * Identity is a safety gate, not a dirty setting.
 *
 * This comparison intentionally ignores color and sourcePresetName. Color belongs to the live
 * drawing session, and a translated/renamed catalogue label does not select another renderer.
 */
export function studioBrushBaselineMatchesSnapshotIdentity(
  baseline: StudioBrushBaseline,
  snapshot: StudioBrushSnapshot,
): boolean {
  return baseline.identity.runtimeBrushId === snapshot.brushId
    && baseline.identity.sourcePresetId === (snapshot.sourcePresetId ?? null);
}

/**
 * Produces the complete CLIP STUDIO-style "modified" projection from the canonical restore plan.
 * No comparison or label table is duplicated here: restore and dirty UI must always agree.
 */
export function inspectStudioBrushBaseline(
  baseline: StudioBrushBaseline,
  snapshot: StudioBrushSnapshot,
  options: StudioBrushBaselineInspectionOptions = {},
): StudioBrushBaselineInspection {
  if (!studioBrushBaselineMatchesSnapshotIdentity(baseline, snapshot)) {
    return Object.freeze({
      status: "invalid",
      baseline,
      reason: "selection-changed",
      transaction: null,
      dirtyFields: Object.freeze([]),
      dirtyLabels: Object.freeze([]),
      dirtyCount: 0,
      summary: "선택한 브러시가 바뀌어 이전 적용 기준선을 사용할 수 없습니다.",
    });
  }

  const transaction = preserveLockedBrushFields(
    planStudioBrushDefaultRestore(snapshot, baseline.profile),
    options,
  );
  const dirtyFields = Object.freeze(
    transaction.changes.map(({ field }) => field),
  );
  const dirtyLabels = Object.freeze(
    transaction.changes.map(({ label }) => label),
  );
  return Object.freeze({
    status: dirtyFields.length === 0 ? "clean" : "modified",
    baseline,
    transaction,
    dirtyFields,
    dirtyLabels,
    dirtyCount: dirtyFields.length,
    summary: transaction.summary,
  });
}

function reconcileSavedBaseline(
  baseline: StudioBrushBaseline,
  brushes: readonly StudioSavedBrush[],
): StudioBrushBaseline | null {
  if (baseline.identity.kind !== "saved") return baseline;
  const savedBrushId = baseline.identity.savedBrushId;
  const current = brushes.find((brush) => brush.id === savedBrushId);
  if (!current) return null;

  const refreshed = createStudioSavedBrushBaseline(current);
  const sameIdentity =
    refreshed.identity.runtimeBrushId === baseline.identity.runtimeBrushId
    && refreshed.identity.sourcePresetId === baseline.identity.sourcePresetId;
  const sameValues = studioBrushDefaultRestoreValuesEqual(
    refreshed.profile.values,
    baseline.profile.values,
  );

  if (!sameIdentity || !sameValues) return null;

  // Name, pin/activity metadata, and color may change without changing the reset contract. Keep the
  // exact object for ordinary activity writes, but refresh it when UI copy actually changed.
  return refreshed.profile.sourceName === baseline.profile.sourceName
    ? baseline
    : refreshed;
}

/**
 * Pure baseline state machine. Property edits need no action and therefore preserve the exact
 * applied baseline identity; only an explicit selection or saved-library lifecycle event changes it.
 */
export function transitionStudioBrushBaseline(
  baseline: StudioBrushBaseline | null,
  action: StudioBrushBaselineAction,
): StudioBrushBaseline | null {
  if (action.type === "brush-selected") {
    return createStudioBrushBaseline(action.selection);
  }
  if (action.type === "selection-invalidated") return null;
  if (!baseline) return null;
  return reconcileSavedBaseline(baseline, action.brushes);
}

/**
 * Runtime companion to the compile-time field gate, useful for architecture tests and diagnostics.
 */
export function studioBrushBaselineAccountedFields(): readonly (
  keyof StudioBrushSnapshot
)[] {
  return Object.freeze([
    ...STUDIO_BRUSH_DEFAULT_RESTORE_FIELDS,
    ...STUDIO_BRUSH_BASELINE_EXCLUDED_FIELDS,
  ]);
}
