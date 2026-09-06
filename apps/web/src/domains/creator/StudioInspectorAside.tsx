import { memo } from "react";

import { StudioBrushSizePresetGrid } from "./StudioBrushSizePresetGrid";
import { StudioInspectorAsideBody } from "./StudioInspectorAsideBody";

export { StudioBrushSizePresetGrid };

export type StudioInspectorAsideHandlers =
  import("./StudioInspectorAsideTypes").StudioInspectorAsideHandlers;
export type StudioInspectorAsideProps =
  import("./StudioInspectorAsideTypes").StudioInspectorAsideProps;

export const StudioInspectorAside = memo(function StudioInspectorAside(
  props: StudioInspectorAsideProps,
) {
  return <StudioInspectorAsideBody {...props} />;
});
