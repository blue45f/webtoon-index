import { createDefaultStudioBg3dSceneDocument } from "./bg3d/studio-bg3d-scene-document";
import {
  computeStudioLinked3dPassRootHash,
  computeStudioLinked3dSceneRevisionSignatures,
  studioLinked3dPassLocator,
  type StudioLinked3dPassRevisionDescriptor,
} from "./studio-linked-3d-pass-transaction";
import {
  ensureStudioLinked3dRenderShot,
  upsertStudioLinked3dRenderLink,
} from "./studio-linked-3d-render-document";
import { migrateStudioShared3dStageCollectionDocument } from "./studio-shared-3d-stage-collection";
import { createStudioShared3dStageDocument } from "./studio-shared-3d-stage-document";

import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";

export function createStudioLinked3dPassRevisionFixture(
  scene: NonNullable<Extract<El, { type: "image" }>["bg3dScene"]>,
  sourceHash: `sha256:${string}`,
  options: {
    readonly revision?: number;
    readonly contentHash?: `sha256:${string}`;
  } = {},
): StudioLinked3dPassRevisionDescriptor {
  const contentHash = options.contentHash ?? `sha256:${"b".repeat(64)}`;
  const withoutRoot = Object.freeze({
    revision: options.revision ?? 1,
    sourceHash,
    ...computeStudioLinked3dSceneRevisionSignatures(scene),
    artifact: Object.freeze({
      pass: "line" as const,
      role: "main-line" as const,
      contentHash,
      byteSize: 68,
      mime: "image/png" as const,
      width: 64,
      height: 64,
      locator: studioLinked3dPassLocator(contentHash),
    }),
  });
  return Object.freeze({
    ...withoutRoot,
    passRootHash: computeStudioLinked3dPassRootHash(withoutRoot),
  });
}

export function createStudioLinked3dRenderPageFixture(
  pageId = "page-linked-3d",
): PageState {
  const scene = ensureStudioLinked3dRenderShot(createDefaultStudioBg3dSceneDocument(), {
    allowCreate: true,
  });
  if (!scene?.activeShotId) throw new Error("Linked 3D test Scene setup failed.");
  const bundleId = `${pageId}-bundle`;
  const groupId = `${pageId}-group`;
  const provisionalElement: Extract<El, { type: "image" }> = {
    id: `${pageId}-main-line`,
    type: "image",
    src: "data:image/png;base64,AA==",
    x: 0,
    y: 0,
    width: 800,
    height: 1_080,
    rotation: 0,
    groupId,
    bg3dLtBundleId: bundleId,
    bg3dLtRole: "main-line",
    bg3dLtRenderMode: "separated",
    bg3dScene: scene,
  };
  const legacyStage = createStudioShared3dStageDocument({
    backgroundBundleId: bundleId,
    elements: [provisionalElement],
    capturePolicy: "background-only",
  });
  const shared3dStage = migrateStudioShared3dStageCollectionDocument(legacyStage);
  if (!shared3dStage) throw new Error("Linked 3D test Stage setup failed.");
  const passRevision = createStudioLinked3dPassRevisionFixture(
    scene,
    shared3dStage.stages[0]!.background.sourceHash,
  );
  const element = {
    ...provisionalElement,
    src: passRevision.artifact.locator,
  } satisfies Extract<El, { type: "image" }>;
  const linked3dRender = upsertStudioLinked3dRenderLink({
    value: undefined,
    bundleId,
    shotId: scene.activeShotId,
    passRevision,
    elements: [element],
    shared3dStage,
  });
  if (!linked3dRender) throw new Error("Linked 3D test receipt setup failed.");
  return {
    id: pageId,
    elements: [element],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1_080,
    groups: [{ id: groupId, name: "Linked 3D" }],
    shared3dStage,
    linked3dRender,
  };
}
