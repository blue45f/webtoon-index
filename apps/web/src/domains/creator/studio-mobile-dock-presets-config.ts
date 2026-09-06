import { StudioMobileSheetHandleBoundary } from "./studio-mobile-dock-presets";
import {
  StudioBrushLibraryPanel,
  StudioBrushStudio,
  StudioShapePickerGrid,
  StudioUnifiedBrushPicker,
  loadStudioBrushStudio,
} from "./studio-page-lazy-ui";

import type { StudioMobileEditingDockUi } from "./StudioMobileEditingDock";

export const STUDIO_MOBILE_EDITING_DOCK_UI: StudioMobileEditingDockUi = {
  StudioBrushLibraryPanel,
  StudioBrushStudio,
  StudioMobileSheetHandle: StudioMobileSheetHandleBoundary,
  StudioShapePickerGrid,
  StudioUnifiedBrushPicker,
  loadStudioBrushStudio,
};
