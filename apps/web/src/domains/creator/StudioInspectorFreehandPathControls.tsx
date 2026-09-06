import { isPressureWidthBrush, type NodeEditTool } from "./studio-node-edit";
import {
  StudioHokusaiNaturalMediaInspectorMount,
  type StudioHokusaiNaturalMediaReplaceHandler,
} from "./StudioHokusaiNaturalMediaInspectorMount";
import { StudioNodeEditPanel } from "./StudioNodeEditPanel";

import type { DrawEl } from "./studio-element-model";
import type { ReactElement } from "react";

interface StudioInspectorFreehandPathControlsProps {
  readonly selected: DrawEl;
  readonly nodeEditTool: NodeEditTool | null;
  readonly nodeEditHandleCount: number;
  readonly nodeSmoothStrength: number;
  readonly refinementBusy: boolean;
  readonly refinementUnavailableReason: string | null;
  readonly currentColor: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly pageId: string;
  readonly masterEditMode: boolean;
  readonly locks: Readonly<{
    collaboration: boolean;
    surfaceReview: boolean;
    selectedContent: boolean;
  }>;
  readonly onToggleNodeEdit: () => void;
  readonly onNodeEditToolChange: (tool: NodeEditTool) => void;
  readonly onNodeSmoothStrengthChange: (strength: number) => void;
  readonly onRequestSelectStroke: () => void;
  readonly onRefine: (operation: "simplify" | "smooth") => void;
  readonly onCancelRefinement: () => void;
  readonly onReplace: StudioHokusaiNaturalMediaReplaceHandler;
}

/**
 * Keeps freehand path editing and optional natural-media conversion in one bounded leaf.
 * Document mutation, tool transitions, collaboration locks, and history stay parent-owned.
 */
export function StudioInspectorFreehandPathControls({
  selected,
  nodeEditTool,
  nodeEditHandleCount,
  nodeSmoothStrength,
  refinementBusy,
  refinementUnavailableReason,
  currentColor,
  documentWidth,
  documentHeight,
  pageId,
  masterEditMode,
  locks,
  onToggleNodeEdit,
  onNodeEditToolChange,
  onNodeSmoothStrengthChange,
  onRequestSelectStroke,
  onRefine,
  onCancelRefinement,
  onReplace,
}: StudioInspectorFreehandPathControlsProps): ReactElement {
  return (
    <>
      <div className="mt-2.5 border-t border-line/40 pt-2.5">
        <StudioNodeEditPanel
          active={nodeEditTool !== null}
          tool={nodeEditTool ?? "move"}
          handleCount={nodeEditHandleCount}
          widthModeSupported={isPressureWidthBrush(selected.brush, selected.mode)}
          smoothStrength={nodeSmoothStrength}
          refinementBusy={refinementBusy}
          refinementUnavailableReason={refinementUnavailableReason}
          onSmoothStrengthChange={onNodeSmoothStrengthChange}
          onToggle={onToggleNodeEdit}
          onToolChange={onNodeEditToolChange}
          onRequestSelectStroke={onRequestSelectStroke}
          onRefine={onRefine}
          onCancelRefinement={onCancelRefinement}
        />
      </div>
      <div className="mt-2.5 border-t border-line/40 pt-2.5">
        <StudioHokusaiNaturalMediaInspectorMount
          visible
          selected={selected}
          currentColor={currentColor}
          documentWidth={documentWidth}
          documentHeight={documentHeight}
          pageId={pageId}
          masterEditMode={masterEditMode}
          locks={locks}
          onReplace={onReplace}
        />
      </div>
    </>
  );
}
