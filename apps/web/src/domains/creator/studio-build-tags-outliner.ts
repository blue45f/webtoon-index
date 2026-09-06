/**
 * Tags / collections / outliner visibility (BLD-007).
 * Separates visibility flags from render-layer membership.
 */

export const STUDIO_BUILD_TAGS_REVISION = 1 as const;

export interface StudioSceneTag {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly renderLayer: number;
}

export interface StudioOutlinerNode {
  readonly id: string;
  readonly label: string;
  readonly parentId: string | null;
  readonly tagIds: readonly string[];
  readonly objectVisible: boolean;
}

export interface StudioTagsOutlinerDocument {
  readonly revision: typeof STUDIO_BUILD_TAGS_REVISION;
  readonly tags: readonly StudioSceneTag[];
  readonly nodes: readonly StudioOutlinerNode[];
}

export function createStudioTagsOutlinerDocument(
  tags: readonly StudioSceneTag[] = [],
  nodes: readonly StudioOutlinerNode[] = [],
): StudioTagsOutlinerDocument {
  return {
    revision: STUDIO_BUILD_TAGS_REVISION,
    tags: [...tags],
    nodes: [...nodes],
  };
}

export function resolveStudioOutlinerVisibility(
  doc: StudioTagsOutlinerDocument,
  nodeId: string,
): {
  readonly visible: boolean;
  readonly renderLayers: readonly number[];
  readonly reason: "object-hidden" | "tag-hidden" | "visible";
} {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return { visible: false, renderLayers: [], reason: "object-hidden" };
  }
  if (!node.objectVisible) {
    return { visible: false, renderLayers: [], reason: "object-hidden" };
  }
  const tags = doc.tags.filter((t) => node.tagIds.includes(t.id));
  if (tags.some((t) => !t.visible)) {
    return {
      visible: false,
      renderLayers: tags.map((t) => t.renderLayer),
      reason: "tag-hidden",
    };
  }
  return {
    visible: true,
    renderLayers: tags.map((t) => t.renderLayer),
    reason: "visible",
  };
}

export function setStudioTagVisibility(
  doc: StudioTagsOutlinerDocument,
  tagId: string,
  visible: boolean,
): StudioTagsOutlinerDocument {
  return {
    ...doc,
    tags: doc.tags.map((t) => (t.id === tagId ? { ...t, visible } : t)),
  };
}
