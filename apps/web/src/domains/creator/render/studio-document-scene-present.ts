import {
  composeMat2d,
  renderSceneToSceneIR,
  rotateMat2d,
  scaleMat2d,
  transformSceneNodes,
  translateMat2d,
  type SceneIR,
  type SceneNodeIR,
} from "@toonspectrum/studio-project-model";

import {
  STUDIO_SCENE_IDENTITY_DOCUMENT_TRANSFORM,
  type StudioSceneDocumentTransform,
} from "../studio-scene-provider";

import {
  documentIdsOwnedByVectorIslands,
  lowerStudioElementsToRenderScene,
  studioDocumentAllowsKonvaHide,
} from "./studio-document-scene-lower";

import type { El } from "../studio-element-model";

/**
 * Document CSS → viewport backing pixels. Matches the overlay host transform
 * so Vello Classic paints in the same place as the Konva Stage.
 */
export function documentTransformToBackingMat2d(
  transform: StudioSceneDocumentTransform,
  dpr: number,
) {
  const scale = scaleMat2d(transform.scaleX, transform.scaleY);
  const rotate = rotateMat2d(transform.rotation);
  const translate = translateMat2d(transform.offsetX, transform.offsetY);
  const backing = scaleMat2d(dpr, dpr);
  return composeMat2d(backing, composeMat2d(translate, composeMat2d(rotate, scale)));
}

export interface StudioDocumentPresentScene {
  readonly scene: SceneIR;
  readonly ownedDocumentIds: readonly string[];
}

export function buildStudioDocumentPresentScene(options: {
  readonly elements: readonly El[];
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly dpr: number;
  readonly documentTransform?: StudioSceneDocumentTransform;
  readonly overlayNodes?: readonly SceneNodeIR[];
  readonly overlayOffsetCss?: { readonly left: number; readonly top: number };
}): StudioDocumentPresentScene {
  const dpr = Math.max(1, options.dpr);
  const document = lowerStudioElementsToRenderScene(options.elements, {
    width: Math.max(1, Math.round(options.documentWidth)),
    height: Math.max(1, Math.round(options.documentHeight)),
  });
  const ownedDocumentIds = documentIdsOwnedByVectorIslands(document);
  const exclusiveVectorPage = studioDocumentAllowsKonvaHide(
    options.elements,
    ownedDocumentIds,
  );
  const vectorNodes = exclusiveVectorPage
    ? renderSceneToSceneIR(document).nodes
    : [];
  const transformed = transformSceneNodes(
    vectorNodes,
    documentTransformToBackingMat2d(
      options.documentTransform ?? STUDIO_SCENE_IDENTITY_DOCUMENT_TRANSFORM,
      dpr,
    ),
  );
  // Mixed pages keep Konva as the visible document + transformer. Feeding
  // selection overlays into a viewport-sized WebGPU swapchain would copy the
  // full backing store every rAF for chrome Konva already paints.
  let overlay: SceneNodeIR[] = [];
  if (exclusiveVectorPage && options.overlayNodes && options.overlayNodes.length > 0) {
    const left = (options.overlayOffsetCss?.left ?? 0) * dpr;
    const top = (options.overlayOffsetCss?.top ?? 0) * dpr;
    overlay = left === 0 && top === 0
      ? [...options.overlayNodes]
      : transformSceneNodes([...options.overlayNodes], translateMat2d(left, top)).nodes;
  }
  return {
    scene: {
      version: 11,
      width: Math.max(1, Math.ceil(options.viewportWidth * dpr)),
      height: Math.max(1, Math.ceil(options.viewportHeight * dpr)),
      background: { r: 0, g: 0, b: 0, a: 0 },
      nodes: [...transformed.nodes, ...overlay],
    },
    ownedDocumentIds: exclusiveVectorPage ? ownedDocumentIds : [],
  };
}
