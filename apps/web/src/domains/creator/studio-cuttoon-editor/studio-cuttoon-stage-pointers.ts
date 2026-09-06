/* Extracted stage pointer handlers from StudioCuttoonEditor.
 * Closures keep the original editor typing envelope via an `any` host bag. */
import type { StudioCuttoonStagePointersHost } from "./studio-cuttoon-stage-pointers-types";
import type { StudioCuttoonStagePointersApi } from "./studio-cuttoon-stage-pointers-api";
import { bindStudioCuttoonStagePointersDownArmed } from "./studio-cuttoon-stage-pointers-down-armed";
import { bindStudioCuttoonStagePointersDownPixel } from "./studio-cuttoon-stage-pointers-down-pixel";
import { bindStudioCuttoonStagePointersDownDraw } from "./studio-cuttoon-stage-pointers-down-draw";
import { bindStudioCuttoonStagePointersDown } from "./studio-cuttoon-stage-pointers-down";
import { bindStudioCuttoonStagePointersSnap } from "./studio-cuttoon-stage-pointers-snap";
import { bindStudioCuttoonStagePointersMove } from "./studio-cuttoon-stage-pointers-move";
import { bindStudioCuttoonStagePointersFixedRate } from "./studio-cuttoon-stage-pointers-fixed-rate";
import { bindStudioCuttoonStagePointersFreehand } from "./studio-cuttoon-stage-pointers-freehand";
import { bindStudioCuttoonStagePointersBatch } from "./studio-cuttoon-stage-pointers-batch";
import { bindStudioCuttoonStagePointersPublish } from "./studio-cuttoon-stage-pointers-publish";
import { bindStudioCuttoonStagePointersQueue } from "./studio-cuttoon-stage-pointers-queue";
import { bindStudioCuttoonStagePointersRelease } from "./studio-cuttoon-stage-pointers-release";
import { bindStudioCuttoonStagePointersFinish } from "./studio-cuttoon-stage-pointers-finish";
import { bindStudioCuttoonStagePointersUp } from "./studio-cuttoon-stage-pointers-up";
import { bindStudioCuttoonStagePointersCursors } from "./studio-cuttoon-stage-pointers-cursors";
import { bindStudioCuttoonStagePointersDrag } from "./studio-cuttoon-stage-pointers-drag";

export type {
  PixelSelectionActivationKind,
  StudioHokusaiPinnedLiveStroke,
  StudioLivingInkPinnedStroke,
  StudioCuttoonStagePointersHost,
} from "./studio-cuttoon-stage-pointers-types";

export function bindStudioCuttoonStagePointers(h: StudioCuttoonStagePointersHost) {
  const api = {} as StudioCuttoonStagePointersApi;
  bindStudioCuttoonStagePointersDownArmed(h, api);
  bindStudioCuttoonStagePointersDownPixel(h, api);
  bindStudioCuttoonStagePointersDownDraw(h, api);
  bindStudioCuttoonStagePointersDown(h, api);
  bindStudioCuttoonStagePointersSnap(h, api);
  bindStudioCuttoonStagePointersMove(h, api);
  bindStudioCuttoonStagePointersFixedRate(h, api);
  bindStudioCuttoonStagePointersFreehand(h, api);
  bindStudioCuttoonStagePointersBatch(h, api);
  bindStudioCuttoonStagePointersPublish(h, api);
  bindStudioCuttoonStagePointersQueue(h, api);
  bindStudioCuttoonStagePointersRelease(h, api);
  bindStudioCuttoonStagePointersFinish(h, api);
  bindStudioCuttoonStagePointersUp(h, api);
  bindStudioCuttoonStagePointersCursors(h, api);
  bindStudioCuttoonStagePointersDrag(h, api);
  return {
    onStageDown: api.onStageDown,
    onStageMove: api.onStageMove,
    onStagePointerCancel: api.onStagePointerCancel,
    onStageUp: api.onStageUp,
    onStageDragMove: api.onStageDragMove,
    onStageDragEnd: api.onStageDragEnd,
    hideStrokeGuide: api.hideStrokeGuide,
    hideBrushCursor: api.hideBrushCursor,
    hideFilterMaskCursor: api.hideFilterMaskCursor,
    hideHealCloneCursors: api.hideHealCloneCursors,
    hideHistoryBrushCursor: api.hideHistoryBrushCursor,
    hideLayerMaskCursor: api.hideLayerMaskCursor,
    hideSmudgeCursor: api.hideSmudgeCursor,
    cancelCanvasGroupDrag: api.cancelCanvasGroupDrag,
    queueStudioRasterDrawPromotion: api.queueStudioRasterDrawPromotion,
    queueStudioBg3dMagicFilterMaskPublication: api.queueStudioBg3dMagicFilterMaskPublication,
    studioPageElementsFromHistory: api.studioPageElementsFromHistory,
  };
}
