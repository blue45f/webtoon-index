/**
 * Selection stroke properties for freehand/shape draw elements.
 * Kept as a leaf so context-property tests can drive the shipped control path
 * without mounting the full StudioInspectorAside graph.
 */
import type { DrawEl, El } from "./studio-element-model";

export interface StudioInspectorSelectionStrokeControlsProps {
  readonly selected: DrawEl;
  readonly patchEl: (id: string, patch: Partial<El>) => void;
}

export function StudioInspectorSelectionStrokeControls({
  selected,
  patchEl,
}: StudioInspectorSelectionStrokeControlsProps) {
  return (
    <div className="space-y-3" data-testid="studio-inspector-selection-stroke-controls">
      <div className="flex items-center justify-between gap-2 text-sm text-fg-2">
        선 색상
        <input
          type="color"
          value={selected.stroke || "#16100c"}
          aria-label="선 색상"
          onChange={(e) => patchEl(selected.id, { stroke: e.target.value } as Partial<El>)}
          className="h-7 w-7 cursor-pointer rounded border border-line bg-transparent"
        />
      </div>
      <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
        선 두께
        <span className="flex items-center gap-1.5">
          <input
            type="range"
            min={1}
            max={48}
            value={selected.strokeWidth ?? 3}
            aria-label="선 두께"
            onChange={(e) => patchEl(selected.id, { strokeWidth: Number(e.target.value) } as Partial<El>)}
            className="w-24 accent-accent cursor-pointer"
          />
          <span className="w-8 text-right text-xs tabular-nums text-fg-3">{selected.strokeWidth ?? 3}px</span>
        </span>
      </label>
      <label className="flex items-center justify-between gap-2 text-sm text-fg-2">
        불투명도
        <span className="flex items-center gap-1.5">
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={selected.opacity ?? 1}
            aria-label="불투명도"
            onChange={(e) => patchEl(selected.id, { opacity: Number(e.target.value) } as Partial<El>)}
            className="w-24 accent-accent cursor-pointer"
          />
          <span className="w-8 text-right text-xs tabular-nums text-fg-3">{Math.round((selected.opacity ?? 1) * 100)}%</span>
        </span>
      </label>
    </div>
  );
}
