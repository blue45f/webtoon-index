/**
 * Exact document-layer raster bake for mixed vector/raster merge plans.
 *
 * `studio-layer-merge-bake.ts` retains its fast Canvas2D path for ImageEl-only sources. This
 * companion handles DrawEl/Text/Bubble/Frame/effect mixtures through the shared SVG serializer
 * and Worker-capable PNG rasterizer. It fails closed on approximated/skipped fidelity and leaves
 * the source document untouched until the caller applies the returned composite in one commit.
 */

import {
  materializeStudioEditableRasterCopy,
  planStudioEditableRasterCopy,
  renderStudioEditableRasterCopy,
  type StudioEditableRasterCopyInput,
  type StudioEditableRasterCopyPlan,
  type StudioEditableRasterCopyPlanResult,
  type StudioEditableRasterCopyRenderer,
} from "../render/studio-raster-edit-preparation";

import {
  applyStudioLayerMergePlan,
  type StudioLayerMergePlan,
} from "./studio-layer-merge";

import type { SvgExportTheme } from "../export/studio-svg-export";
import type { El, ImageEl } from "../studio-element-model";
import type { LayerGroup } from "../studio-layers";
import type {
  StudioVectorReferenceBudgets,
  StudioVectorReferenceRenderOptions,
  StudioVectorReferenceResult,
} from "../studio-vector-fill-reference";

export interface StudioDocumentMergeBakeInput {
  readonly plan: StudioLayerMergePlan;
  readonly pageId: string;
  readonly width: number;
  readonly height: number;
  readonly elements: readonly El[];
  readonly groups?: readonly LayerGroup[];
  readonly theme?: SvgExportTheme;
  readonly documentMutationBlockedReason?: string | null;
  readonly budgets?: StudioVectorReferenceBudgets;
}

export interface StudioDocumentMergeBakePlan {
  readonly merge: StudioLayerMergePlan;
  readonly raster: StudioEditableRasterCopyPlan;
}

export type StudioDocumentMergeBakePlanResult =
  | { readonly ok: true; readonly plan: StudioDocumentMergeBakePlan }
  | {
      readonly ok: false;
      readonly code: "invalid-merge-plan" | Extract<StudioEditableRasterCopyPlanResult, { ok: false }>["code"];
      readonly reason: string;
    };

function rasterCopyInput(input: StudioDocumentMergeBakeInput): StudioEditableRasterCopyInput {
  return {
    pageId: input.pageId,
    width: input.width,
    height: input.height,
    elements: input.elements,
    groups: input.groups,
    sourceIds: input.plan.sources
      .toSorted((left, right) => left.zIndex - right.zIndex)
      .map((source) => source.id),
    theme: input.theme,
    includeBackground: false,
    name: input.plan.resultName,
    insertionIndex: input.plan.insertIndex,
    documentMutationBlockedReason: input.documentMutationBlockedReason,
    budgets: input.budgets,
  };
}

export function planStudioDocumentMergeBake(
  input: StudioDocumentMergeBakeInput,
): StudioDocumentMergeBakePlanResult {
  const sourceIds = input.plan.sources.map((source) => source.id);
  const uniqueSourceIds = new Set(sourceIds);
  const uniqueRemoveIds = new Set(input.plan.removeIds);
  if (
    sourceIds.length < 2
    || uniqueSourceIds.size !== sourceIds.length
    || input.plan.removeIds.length !== sourceIds.length
    || uniqueRemoveIds.size !== input.plan.removeIds.length
    || input.plan.removeIds.some((id) => !uniqueSourceIds.has(id))
  ) {
    return {
      ok: false,
      code: "invalid-merge-plan",
      reason: "병합 계획의 원본 레이어 목록이 올바르지 않습니다.",
    };
  }
  const availableIds = new Set(input.elements.map((element) => element.id));
  if (sourceIds.some((id) => !availableIds.has(id))) {
    return {
      ok: false,
      code: "invalid-merge-plan",
      reason: "병합할 원본 레이어가 변경되었거나 사라졌습니다. 레이어를 다시 선택하세요.",
    };
  }

  const raster = planStudioEditableRasterCopy(rasterCopyInput(input));
  if (!raster.ok) return raster;
  if (
    raster.plan.sourceIds.length !== sourceIds.length
    || raster.plan.sourceIds.some((id) => !uniqueSourceIds.has(id))
  ) {
    return {
      ok: false,
      code: "invalid-merge-plan",
      reason: "숨김 상태가 바뀐 레이어가 있어 병합을 중단했습니다. 표시 상태를 확인한 뒤 다시 시도하세요.",
    };
  }
  return { ok: true, plan: { merge: input.plan, raster: raster.plan } };
}

export async function renderStudioDocumentMergeBake(
  plan: StudioDocumentMergeBakePlan,
  renderVectorReference: StudioEditableRasterCopyRenderer,
  options: StudioVectorReferenceRenderOptions = {},
): Promise<StudioVectorReferenceResult> {
  return renderStudioEditableRasterCopy(plan.raster, renderVectorReference, options);
}

export function materializeStudioDocumentMergeBake(input: {
  readonly plan: StudioDocumentMergeBakePlan;
  readonly rendered: StudioVectorReferenceResult;
  readonly newId: string;
}): ImageEl & El {
  return materializeStudioEditableRasterCopy({
    plan: input.plan.raster,
    rendered: input.rendered,
    newId: input.newId,
  });
}

/** Remove all merge sources and insert the one raster composite in BACK -> FRONT order. */
export function applyStudioDocumentMergeBake(
  elements: readonly El[],
  plan: StudioDocumentMergeBakePlan,
  composite: ImageEl & El,
): El[] {
  return applyStudioLayerMergePlan(elements, plan.merge, composite);
}

export function isStudioDocumentMergeBakePlanCurrent(
  plan: StudioDocumentMergeBakePlan,
  current: StudioDocumentMergeBakeInput,
): boolean {
  const next = planStudioDocumentMergeBake(current);
  if (!next.ok) return false;
  return next.plan.raster.sourceFingerprint === plan.raster.sourceFingerprint
    && next.plan.raster.insertionIndex === plan.raster.insertionIndex
    && next.plan.merge.kind === plan.merge.kind
    && next.plan.merge.insertIndex === plan.merge.insertIndex
    && next.plan.merge.sources.length === plan.merge.sources.length
    && next.plan.merge.sources.every((source, index) => {
      const previous = plan.merge.sources[index];
      return previous?.id === source.id && previous.zIndex === source.zIndex;
    })
    && next.plan.merge.removeIds.length === plan.merge.removeIds.length
    && next.plan.merge.removeIds.every((id, index) => plan.merge.removeIds[index] === id);
}
