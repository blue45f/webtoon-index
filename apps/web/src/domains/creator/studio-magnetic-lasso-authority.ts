import type { SelectionLuminanceField } from "./studio-selection-tools";

export const STUDIO_MAGNETIC_LASSO_PROVIDER_ID = "luminance-edge-snap" as const;

export function studioMagneticLassoFieldKey(
  imageId: string,
  source: string,
  flipX: boolean,
  flipY: boolean,
): string {
  return [
    imageId,
    source,
    flipX ? "flip-x" : "normal-x",
    flipY ? "flip-y" : "normal-y",
  ].join("\u001f");
}

/**
 * Load state for the one magnetic-lasso provider selected by the tool toggle.
 *
 * `key` identifies the immutable image/flip snapshot the provider was prepared for. A ready
 * field for a different key is deliberately not reusable: doing so would move the gesture onto
 * stale pixels and would also blur the operation boundary between two provider epochs.
 */
export type StudioMagneticLassoFieldState =
  | { readonly status: "disabled" }
  | { readonly status: "loading"; readonly key: string }
  | {
      readonly status: "ready";
      readonly key: string;
      readonly field: SelectionLuminanceField;
    }
  | {
      readonly status: "unavailable";
      readonly key: string;
      readonly reason: string;
    };

export type StudioMagneticLassoGestureResolution =
  | { readonly status: "ordinary"; readonly field: null }
  | {
      readonly status: "selected";
      readonly providerId: typeof STUDIO_MAGNETIC_LASSO_PROVIDER_ID;
      readonly field: SelectionLuminanceField;
    }
  | {
      readonly status: "rejected";
      readonly providerId: typeof STUDIO_MAGNETIC_LASSO_PROVIDER_ID;
      readonly field: null;
      readonly reason: string;
    };

/**
 * Resolves the execution provider before a lasso gesture mutates any selection state.
 *
 * A null key means the user explicitly selected ordinary lasso. A non-null key means magnetic
 * lasso owns the operation; loading, stale, and failed epochs reject instead of silently running
 * the same gesture through the ordinary lasso implementation.
 */
export function resolveStudioMagneticLassoGesture(
  selectedKey: string | null,
  state: StudioMagneticLassoFieldState,
): StudioMagneticLassoGestureResolution {
  if (selectedKey === null) return { status: "ordinary", field: null };
  if (state.status === "ready" && state.key === selectedKey) {
    return {
      status: "selected",
      providerId: STUDIO_MAGNETIC_LASSO_PROVIDER_ID,
      field: state.field,
    };
  }
  if (state.status === "unavailable" && state.key === selectedKey) {
    return {
      status: "rejected",
      providerId: STUDIO_MAGNETIC_LASSO_PROVIDER_ID,
      field: null,
      reason: state.reason,
    };
  }
  return {
    status: "rejected",
    providerId: STUDIO_MAGNETIC_LASSO_PROVIDER_ID,
    field: null,
    reason: "선택한 자석 올가미 표면을 아직 준비하지 못했습니다.",
  };
}
