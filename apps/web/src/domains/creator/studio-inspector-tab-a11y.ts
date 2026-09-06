import {
  STUDIO_DOCUMENT_INSPECTOR_SECTIONS,
  STUDIO_IMAGE_INSPECTOR_SECTIONS,
  STUDIO_INSPECTOR_PRIMARY_SECTIONS,
} from "./studio-inspector-layout";

import type {
  StudioDocumentInspectorSection,
  StudioImageInspectorSection,
  StudioInspectorPrimarySection,
} from "./studio-inspector-layout";

interface StudioInspectorTabPanelIds {
  readonly tabId: string;
  readonly panelId: string;
}

export interface StudioInspectorTabA11y {
  readonly primary: Record<StudioInspectorPrimarySection, StudioInspectorTabPanelIds>;
  readonly document: Record<StudioDocumentInspectorSection, StudioInspectorTabPanelIds>;
  readonly imageTabs: Record<StudioImageInspectorSection, string>;
  readonly imagePanels: {
    readonly selected: string;
    readonly unselected: string;
  };
}

export function createStudioInspectorTabA11y(prefix: string): StudioInspectorTabA11y {
  const id = (suffix: string) => `${prefix}-studio-inspector-${suffix}`;
  return {
    primary: Object.fromEntries(
      STUDIO_INSPECTOR_PRIMARY_SECTIONS.map((section) => [
        section,
        { tabId: id(`tab-${section}`), panelId: id(`panel-${section}`) },
      ]),
    ) as Record<StudioInspectorPrimarySection, StudioInspectorTabPanelIds>,
    document: Object.fromEntries(
      STUDIO_DOCUMENT_INSPECTOR_SECTIONS.map((section) => [
        section,
        { tabId: id(`document-tab-${section}`), panelId: id(`document-panel-${section}`) },
      ]),
    ) as Record<StudioDocumentInspectorSection, StudioInspectorTabPanelIds>,
    imageTabs: Object.fromEntries(
      STUDIO_IMAGE_INSPECTOR_SECTIONS.map((section) => [
        section,
        id(`image-tab-${section}`),
      ]),
    ) as Record<StudioImageInspectorSection, string>,
    imagePanels: {
      selected: id("image-panel-selected"),
      unselected: id("image-panel-unselected"),
    },
  };
}
