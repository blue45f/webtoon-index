import {
  computeCustomShapePointsForBubble,
  hasCustomBubbleShape,
} from "./lettering/studio-bubble-custom-shape";
import { normalizeExtraTails } from "./lettering/studio-bubble-path";
import {
  applyBubbleQuickTransform,
  bubbleQuickTransformUnavailableReason,
} from "./lettering/studio-bubble-quick-transform";
import { StudioBubbleShapePanel } from "./lettering/StudioBubbleShapePanel";

import type { BubbleEl } from "./studio-element-model";

interface StudioInspectorBubbleShapeControlsProps {
  readonly active: boolean;
  readonly editActive: boolean;
  readonly mutationLocked: boolean;
  readonly onAddPoint: () => void;
  readonly onDisarmPixelTools: () => void;
  readonly onPatch: (patch: Partial<BubbleEl>) => void;
  readonly onRemovePoint: () => void;
  readonly onSetEditActive: (active: boolean) => void;
  readonly pointCount: number;
  readonly selected: BubbleEl;
  readonly selectedPointIndex: number | null;
  readonly webtoonTheme: "classic" | "soft" | "vivid";
}

export function StudioInspectorBubbleShapeControls({
  active,
  editActive,
  mutationLocked,
  onAddPoint,
  onDisarmPixelTools,
  onPatch,
  onRemovePoint,
  onSetEditActive,
  pointCount,
  selected,
  selectedPointIndex,
  webtoonTheme,
}: StudioInspectorBubbleShapeControlsProps) {
  const hasCustomShape = hasCustomBubbleShape(selected.customShapePoints);
  return (
    <StudioBubbleShapePanel
      canCustomize={selected.variant !== "double" || hasCustomShape}
      hasCustomShape={hasCustomShape}
      active={active}
      pointCount={pointCount || Math.floor((selected.customShapePoints?.length ?? 0) / 2)}
      selectedPointIndex={selectedPointIndex}
      pointActionsDisabled={mutationLocked}
      onAddPoint={onAddPoint}
      onRemovePoint={onRemovePoint}
      quickTransformDisabled={mutationLocked}
      quickTransformFlipDisabled={Boolean(selected.tailAnchorId || selected.tailAnchorPoint)}
      quickTransformUnavailableReasons={{
        widen: bubbleQuickTransformUnavailableReason(selected, "widen"),
        narrow: bubbleQuickTransformUnavailableReason(selected, "narrow"),
        heighten: bubbleQuickTransformUnavailableReason(selected, "heighten"),
        shorten: bubbleQuickTransformUnavailableReason(selected, "shorten"),
        "flip-horizontal": bubbleQuickTransformUnavailableReason(selected, "flip-horizontal"),
        "flip-vertical": bubbleQuickTransformUnavailableReason(selected, "flip-vertical"),
      }}
      onQuickTransform={(action) => {
        if (mutationLocked) return;
        const transformed = applyBubbleQuickTransform(selected, action);
        if (transformed.changed) onPatch(transformed.patch);
      }}
      onConvert={() => {
        if (mutationLocked) return;
        const points = computeCustomShapePointsForBubble({
          width: selected.width,
          height: selected.height,
          theme: webtoonTheme,
          tail: selected.tail,
          tailDirection: selected.tailDirection,
          tailXRatio: selected.tailXRatio,
          tailHeight: selected.tailHeight,
          tailBase: selected.tailBase,
          tailBend: selected.tailBend,
          extraTails: normalizeExtraTails(selected.extraTails),
        });
        onPatch({ customShapePoints: points });
      }}
      onToggleEdit={() => {
        if (mutationLocked) return;
        if (!editActive) onDisarmPixelTools();
        onSetEditActive(!editActive);
      }}
      onRevert={() => {
        if (mutationLocked) return;
        onSetEditActive(false);
        onPatch({ customShapePoints: undefined });
      }}
    />
  );
}
