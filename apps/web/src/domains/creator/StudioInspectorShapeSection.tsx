import { Suspense } from "react";

import { normalizeShapeParams, normalizeStrokeStyle } from "./brush/studio-stroke-shapes";
import { CANVAS_W } from "./studio-assets";
import { legacyTextGradientToSpec } from "./studio-gradient-engine";
import {
  StudioGradientEnginePanel,
  StudioPatternFillPanel,
  StudioStrokeShapePanel,
} from "./studio-page-lazy-ui";
import {
  DEFAULT_STUDIO_SKETCH_STYLE,
  studioSketchStyleOfElement,
} from "./studio-rough-shape";
import { StudioInspectorFreehandPathControls } from "./StudioInspectorFreehandPathControls";
import { StudioInspectorSection } from "./StudioInspectorSection";
import { StudioInspectorSelectionStrokeControls } from "./StudioInspectorSelectionStrokeControls";
import { StudioPanelLoading } from "./StudioLazySurfaceFallback";

import type { Tool } from "./studio-editor-tool-model";
import type { DrawEl, El, TextEl } from "./studio-element-model";
import type { NodeEditHandle, NodeEditTool } from "./studio-node-edit";
import type { StudioHokusaiNaturalMediaReplaceHandler } from "./StudioHokusaiNaturalMediaInspectorMount";




import { cn } from "@/shared/lib/utils";

interface StudioInspectorShapeSectionProps {
  selected: DrawEl;
  patchEl: (id: string, patch: Partial<El>) => void;
  nodeEditTool: NodeEditTool | null;
  nodeEditHandles: NodeEditHandle[];
  nodeSmoothStrength: number;
  paperVectorRefinementBusy: boolean;
  paperVectorRefinementUnavailableReason: string | null;
  color: string;
  canvasH: number;
  currentPageId: string;
  masterEditMode: boolean;
  collaborationDocumentLocked: boolean;
  activeSurfaceReviewLocked: boolean;
  selectedContentMutationLocked: boolean;
  setNodeEditTool: import("react").Dispatch<import("react").SetStateAction<NodeEditTool | null>>;
  setNodeSmoothStrength: import("react").Dispatch<import("react").SetStateAction<number>>;
  setTool: import("react").Dispatch<import("react").SetStateAction<Tool>>;
  disarmAllPixelTools: () => void;
  announceDrawingShortcut: (message: string) => void;
  applyPaperVectorRefinement: (operation: "simplify" | "smooth") => void;
  cancelPaperVectorRefinement: () => void;
  replaceDrawWithHokusaiNaturalMedia: StudioHokusaiNaturalMediaReplaceHandler;
}

export function StudioInspectorShapeSection({
  selected,
  patchEl,
  nodeEditTool,
  nodeEditHandles,
  nodeSmoothStrength,
  paperVectorRefinementBusy,
  paperVectorRefinementUnavailableReason,
  color,
  canvasH,
  currentPageId,
  masterEditMode,
  collaborationDocumentLocked,
  activeSurfaceReviewLocked,
  selectedContentMutationLocked,
  setNodeEditTool,
  setNodeSmoothStrength,
  setTool,
  disarmAllPixelTools,
  announceDrawingShortcut,
  applyPaperVectorRefinement,
  cancelPaperVectorRefinement,
  replaceDrawWithHokusaiNaturalMedia,
}: StudioInspectorShapeSectionProps) {
  return (
    <StudioInspectorSection sectionId="element.shape-style" loadingLabel="도형 스타일을 여는 중...">
      <div className="space-y-3">
        <StudioInspectorSelectionStrokeControls
          selected={selected}
          patchEl={patchEl}
        />
        {(selected.kind === "rect" ||
          selected.kind === "ellipse" ||
          selected.kind === "star" ||
          selected.kind === "triangle" ||
          selected.kind === "polygon") && (
          <div className="mt-2.5 border-t border-line/40 pt-2.5 space-y-2.5">
            <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">채우기</p>
            <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
              채우기 색상
              <input
                type="color"
                value={selected.fill || "#ffffff"}
                aria-label="채우기 색상"
                onChange={(e) => patchEl(selected.id, { fill: e.target.value } as Partial<El>)}
                className="h-7 w-7 cursor-pointer rounded border border-line bg-transparent"
              />
            </div>
            {(selected.kind === "rect" || selected.kind === "ellipse" || selected.kind === "star") && (
              <StudioGradientEnginePanel
                value={selected.gradient ?? null}
                onChange={(spec) => patchEl(selected.id, { gradient: spec ?? undefined } as Partial<El>)}
                title="그라데이션 채우기"
              />
            )}
            <div className="border-t border-line/40 pt-2.5">
              <StudioPatternFillPanel
                value={selected.pattern ?? null}
                onChange={(spec) => patchEl(selected.id, { pattern: spec ?? undefined } as Partial<El>)}
              />
            </div>
          </div>
        )}
        {selected.kind && selected.kind !== "freehand" && (
          <div className="mt-2.5 border-t border-line/40 pt-2.5">
            <Suspense fallback={<StudioPanelLoading label="선 스타일 패널을 여는 중..." />}>
              <StudioStrokeShapePanel
                kind={selected.kind}
                strokeStyle={normalizeStrokeStyle(selected.strokeStyle)}
                shapeParams={normalizeShapeParams(selected.shapeParams)}
                sketch={studioSketchStyleOfElement(selected) ?? DEFAULT_STUDIO_SKETCH_STYLE}
                onPatchStrokeStyle={(patch) =>
                  patchEl(selected.id, {
                    strokeStyle: { ...normalizeStrokeStyle(selected.strokeStyle), ...patch },
                  } as Partial<El>)
                }
                onPatchShapeParams={(patch) =>
                  patchEl(selected.id, {
                    shapeParams: { ...normalizeShapeParams(selected.shapeParams), ...patch },
                  } as Partial<El>)
                }
                onPatchSketch={(patch) =>
                  patchEl(selected.id, {
                    sketch: {
                      ...(studioSketchStyleOfElement(selected) ?? DEFAULT_STUDIO_SKETCH_STYLE),
                      ...patch,
                    },
                  } as Partial<El>)
                }
              />
            </Suspense>
          </div>
        )}
        {(selected.kind ?? "freehand") === "freehand" && (
          <StudioInspectorFreehandPathControls
            selected={selected}
            nodeEditTool={nodeEditTool}
            nodeEditHandleCount={nodeEditHandles.length}
            nodeSmoothStrength={nodeSmoothStrength}
            refinementBusy={paperVectorRefinementBusy}
            refinementUnavailableReason={paperVectorRefinementUnavailableReason}
            currentColor={color}
            documentWidth={CANVAS_W}
            documentHeight={canvasH}
            pageId={currentPageId}
            masterEditMode={masterEditMode}
            locks={{
              collaboration: collaborationDocumentLocked,
              surfaceReview: activeSurfaceReviewLocked,
              selectedContent: selectedContentMutationLocked,
            }}
            onToggleNodeEdit={() => {
              if (nodeEditTool) {
                setNodeEditTool(null);
                return;
              }
              disarmAllPixelTools();
              setNodeEditTool("move");
            }}
            onNodeEditToolChange={setNodeEditTool}
            onNodeSmoothStrengthChange={setNodeSmoothStrength}
            onRequestSelectStroke={() => {
              setNodeEditTool(null);
              disarmAllPixelTools();
              setTool("select");
              announceDrawingShortcut("경로를 정리할 자유곡선 선화를 선택하세요 · Esc로 취소");
            }}
            onRefine={applyPaperVectorRefinement}
            onCancelRefinement={cancelPaperVectorRefinement}
            onReplace={replaceDrawWithHokusaiNaturalMedia}
          />
        )}
      </div>
    </StudioInspectorSection>
  );
}

interface StudioInspectorTextFillSectionProps {
  selected: TextEl;
  patchEl: (id: string, patch: Partial<El>) => void;
}

export function StudioInspectorTextFillSection({
  selected,
  patchEl,
}: StudioInspectorTextFillSectionProps) {
  return (
    <StudioInspectorSection sectionId="element.text-fill" loadingLabel="글자 채우기 스타일을 여는 중...">
      <div className="space-y-2.5">
        <div className="flex gap-1.5 bg-card rounded-lg p-0.5 border border-line">
          {[
            { label: "단색 채우기", v: "solid" },
            { label: "그라데이션", v: "gradient" },
          ].map((mode) => (
            <button
              key={mode.v}
              type="button"
              onClick={() => patchEl(selected.id, { fillType: mode.v as "solid" | "gradient" } as Partial<El>)}
              aria-pressed={(selected.fillType ?? "solid") === mode.v}
              className={cn(
                "flex-1 rounded py-1 text-[0.68rem] font-semibold transition-colors",
                (selected.fillType ?? "solid") === mode.v
                  ? "bg-accent text-on-accent"
                  : "text-fg-2 hover:bg-raised"
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {(selected.fillType ?? "solid") === "gradient" && (
          <div className="space-y-2 pt-1">
            <StudioGradientEnginePanel
              value={selected.gradient ?? legacyTextGradientToSpec(selected.gradientColorStart, selected.gradientColorEnd, selected.gradientDirection)}
              onChange={(spec) => patchEl(selected.id, { gradient: spec ?? undefined } as Partial<El>)}
              allowClear={false}
              title="그라데이션 편집"
            />
          </div>
        )}
      </div>
    </StudioInspectorSection>
  );
}
