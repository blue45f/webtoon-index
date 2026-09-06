import { RotateCw, Search, ScanLine } from "lucide-react";
import { memo } from "react";

import { StudioRailToolButton } from "./studio-chrome-ui";

import type {
  StudioToolHintPreviewVariant,
} from "./studio-tool-hint-preview-kind";

interface StudioLeftToolRailViewToolsClusterProps {
  isRailToolVisible: (id: "zoom" | "zoom-fit" | "rotate-view") => boolean;
  zoomViewToolOpen: boolean;
  rotateViewToolOpen: boolean;
  zoomViewToolLabel: string;
  rotateViewToolLabel: string;
  zoomViewToolDescription: string;
  rotateViewToolDescription: string;
  zoomViewToolHintPreview: "view-hud";
  zoomViewToolHintVariant: Extract<
    StudioToolHintPreviewVariant<"view-hud">,
    "zoom-open" | "zoom-close"
  >;
  rotateViewToolHintPreview: "view-hud";
  rotateViewToolHintVariant: Extract<
    StudioToolHintPreviewVariant<"view-hud">,
    "rotate-open" | "rotate-close"
  >;
  onFitCanvasToWidth: () => void;
  onToggleZoomView: () => void;
  onToggleRotateView: () => void;
  viewTransformSuppressed: boolean;
}

function viewUnavailableReason(isSuppressed: boolean): string | undefined {
  return isSuppressed ? "내보내기·저장이 끝난 뒤 보기를 조절하세요." : undefined;
}

export const StudioLeftToolRailViewToolsCluster = memo(function StudioLeftToolRailViewToolsCluster(
  {
    isRailToolVisible,
    zoomViewToolOpen,
    rotateViewToolOpen,
    zoomViewToolLabel,
    rotateViewToolLabel,
    zoomViewToolDescription,
    rotateViewToolDescription,
    zoomViewToolHintPreview,
    zoomViewToolHintVariant,
    rotateViewToolHintPreview,
    rotateViewToolHintVariant,
    onFitCanvasToWidth,
    onToggleZoomView,
    onToggleRotateView,
    viewTransformSuppressed,
  }: StudioLeftToolRailViewToolsClusterProps,
) {
  return (
    <>
      {isRailToolVisible("zoom") ? (
        <StudioRailToolButton
          data-studio-view-tool-trigger="zoom"
          data-studio-rail-tool-id="zoom"
          icon={Search}
          label={zoomViewToolLabel}
          description={zoomViewToolDescription}
          hintPreview={zoomViewToolHintPreview}
          hintPreviewVariant={zoomViewToolHintVariant}
          active={zoomViewToolOpen}
          disabled={viewTransformSuppressed}
          unavailableReason={viewUnavailableReason(viewTransformSuppressed)}
          aria-expanded={zoomViewToolOpen}
          aria-controls="studio-view-tools-hud-zoom"
          onClick={onToggleZoomView}
        />
      ) : null}
      {isRailToolVisible("zoom-fit") ? (
        <StudioRailToolButton
          data-studio-rail-tool-id="zoom-fit"
          icon={ScanLine}
          label="너비에 맞춤 (Home)"
          description="캔버스 폭에 맞춰 확대·축소합니다."
          hintPreview="zoom-view"
          hintPreviewVariant="fit-width"
          disabled={viewTransformSuppressed}
          unavailableReason={viewUnavailableReason(viewTransformSuppressed)}
          onClick={onFitCanvasToWidth}
        />
      ) : null}
      {isRailToolVisible("rotate-view") ? (
        <StudioRailToolButton
          icon={RotateCw}
          data-studio-rail-tool-id="rotate-view"
          label={rotateViewToolLabel}
          description={rotateViewToolDescription}
          hintPreview={rotateViewToolHintPreview}
          hintPreviewVariant={rotateViewToolHintVariant}
          active={rotateViewToolOpen}
          disabled={viewTransformSuppressed}
          unavailableReason={viewUnavailableReason(viewTransformSuppressed)}
          aria-expanded={rotateViewToolOpen}
          aria-controls="studio-view-tools-hud-rotate"
          data-studio-view-tool-trigger="rotate"
          onClick={onToggleRotateView}
        />
      ) : null}
    </>
  );
});
