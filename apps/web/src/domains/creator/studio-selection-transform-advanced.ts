/**
 * Precision transform façade for the Studio inspector.
 *
 * The legacy module remains authoritative for draw geometry, flips and zoom. The production
 * inspector imports this façade so capability readouts and atomic commits cannot drift apart.
 */

export {
  planStudioSelectionFlip,
  planStudioZoomToSelection,
  selectStudioFigmaDesignTargets,
  unionStudioSelectionBounds,
} from "./studio-figma-selection-ux";
export { resolveStudioFigmaSelectionLayoutMetrics } from "./studio-selection-transform-metrics";
export { planStudioSelectionLayoutPatch } from "./studio-selection-transform-single";
export { planStudioMultiSelectionLayoutPatch } from "./studio-selection-transform-multi";
export type {
  StudioFigmaSelectionLayoutMetrics,
  StudioFigmaSelectionLayoutPatch,
  StudioSelectionResizeAnchor,
  StudioSelectionStrokeWidthPolicy,
} from "./studio-selection-transform-contract";
