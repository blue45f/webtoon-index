import { describe, expect, it } from "vitest";

import {
  captureStudioBg3dShot,
  createDefaultStudioBg3dSceneDocument,
  type StudioBg3dSceneDocument,
} from "./bg3d/studio-bg3d-scene-document";
import {
  STUDIO_LINKED_3D_RENDER_DOCUMENT_KIND,
  STUDIO_LINKED_3D_RENDER_DOCUMENT_VERSION,
  createStudioLinked3dCorrectionProvenance,
  detachStudioLinked3dCorrections,
  ensureStudioLinked3dRenderShot,
  parseStudioLinked3dRenderDocument,
  reconcileStudioLinked3dRenderDocumentAfterElementMutation,
  remapStudioLinked3dRenderDocumentElementIds,
  removeStudioLinked3dRenderLinks,
  serializeStudioLinked3dRenderDocument,
  upsertStudioLinked3dRenderLink,
  validateStudioLinked3dRenderDocumentAgainstPage,
  validateStudioLinked3dReservedPageState,
  type StudioLinked3dRenderDocument,
  type StudioLinked3dRenderElementLike,
} from "./studio-linked-3d-render-document";
import { createStudioLinked3dPassRevisionFixture } from "./studio-linked-3d-render-test-fixture";
import { createStudioShared3dStageDocument } from "./studio-shared-3d-stage-document";

import type { StudioBg3dLtLayerRole } from "./bg3d/studio-bg3d-lt-layer-plan";
import type { StudioLinked3dPassRevisionDescriptor } from "./studio-linked-3d-pass-transaction";

const ROLES = ["tone", "texture-line", "main-line"] as const satisfies readonly StudioBg3dLtLayerRole[];

function sceneWithActiveShot(): StudioBg3dSceneDocument {
  const captured = captureStudioBg3dShot(createDefaultStudioBg3dSceneDocument(), {
    id: "shot-canvas",
    name: "Canvas linked shot",
  });
  if (!captured) throw new Error("Test scene shot setup failed.");
  return captured;
}

function linkedElements(
  scene: StudioBg3dSceneDocument,
  bundleId = "bundle-a",
  passRevision?: StudioLinked3dPassRevisionDescriptor,
): readonly StudioLinked3dRenderElementLike[] {
  return ROLES.map((role, index) => ({
    id: `${bundleId}-${role}`,
    type: "image",
    groupId: `${bundleId}-group`,
    x: 120,
    y: 80,
    width: 960,
    height: 540,
    rotation: 0,
    src: role === "main-line" && passRevision
      ? passRevision.artifact.locator
      : "data:image/png;base64,AA==",
    bg3dLtBundleId: bundleId,
    bg3dLtRole: role,
    ...(index === ROLES.length - 1 ? { bg3dScene: scene } : {}),
  }));
}

function createStage(
  elements: readonly StudioLinked3dRenderElementLike[],
  bundleId = "bundle-a",
  dccSource = false,
) {
  const stage = createStudioShared3dStageDocument({
    backgroundBundleId: bundleId,
    elements,
    capturePolicy: "background-only",
    ...(dccSource ? {
      dccSource: {
        sourceDocumentId: "dcc-document",
        sourceStateHash: "dcc-state",
        sourceWorkspaceHash: `sha256:${"a".repeat(64)}`,
        sourceBridgeSetHash: "dcc-bridge-set",
        sourceCommandCount: 7,
        sourceBridgeCommandSequence: 11,
      },
    } : {}),
  });
  if (!stage) throw new Error("Test shared stage setup failed.");
  return stage;
}

function materializedLink(options: {
  readonly sourceShotId?: string | null;
  readonly dccSource?: boolean;
} = {}) {
  const scene = sceneWithActiveShot();
  const provisionalElements = linkedElements(scene);
  const provisionalStage = createStage(
    provisionalElements,
    "bundle-a",
    options.dccSource ?? false,
  );
  const passRevision = createStudioLinked3dPassRevisionFixture(
    scene,
    provisionalStage.background.sourceHash,
  );
  const elements = linkedElements(scene, "bundle-a", passRevision);
  const stage = createStage(elements, "bundle-a", options.dccSource ?? false);
  const document = upsertStudioLinked3dRenderLink({
    value: undefined,
    bundleId: "bundle-a",
    shotId: scene.activeShotId!,
    ...(options.sourceShotId === undefined ? {} : { sourceShotId: options.sourceShotId }),
    passRevision,
    elements,
    shared3dStage: stage,
  });
  if (!document) throw new Error("Test linked-render setup failed.");
  return { scene, elements, stage, passRevision, document };
}

function onlyLink(document: StudioLinked3dRenderDocument) {
  const link = document.links[0];
  if (!link) throw new Error("Expected a linked-render fixture entry.");
  return link;
}

describe("Studio linked 3D render document", () => {
  it("strictly parses, freezes, and round-trips the bounded layer receipt", () => {
    const { document } = materializedLink();
    const serialized = serializeStudioLinked3dRenderDocument(document);

    expect(serialized).not.toBeNull();
    expect(parseStudioLinked3dRenderDocument(JSON.parse(serialized!))).toEqual(document);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.links)).toBe(true);
    expect(onlyLink(document)).toMatchObject({
      bundleId: "bundle-a",
      shotId: "shot-canvas",
      sourceShotId: null,
      layers: ROLES.map((role) => ({ elementId: `bundle-a-${role}`, role })),
    });
  });

  it("creates a canonical Canvas shot only when allowed and otherwise preserves a real active shot", () => {
    const generic = createDefaultStudioBg3dSceneDocument();

    expect(ensureStudioLinked3dRenderShot(generic, { allowCreate: false })).toBeNull();

    const captured = ensureStudioLinked3dRenderShot(generic, { allowCreate: true });
    expect(captured?.activeShotId).toMatch(/^canvas-[a-f0-9]{24}$/u);
    expect(captured?.shots).toHaveLength(1);
    expect(ensureStudioLinked3dRenderShot(captured!, { allowCreate: true })).toBe(captured);
  });

  it("rejects a stale active Shot after the live view changes and captures a new Canvas Shot only when allowed", () => {
    const captured = sceneWithActiveShot();
    const changedView = {
      ...captured,
      camera: {
        ...captured.camera,
        position: [
          captured.camera.position[0] + 1,
          captured.camera.position[1],
          captured.camera.position[2],
        ],
      },
    } satisfies StudioBg3dSceneDocument;

    expect(ensureStudioLinked3dRenderShot(changedView, { allowCreate: false })).toBeNull();
    const recaptured = ensureStudioLinked3dRenderShot(changedView, { allowCreate: true });
    expect(recaptured?.activeShotId).toMatch(/^canvas-[a-f0-9]{24}$/u);
    expect(recaptured?.activeShotId).not.toBe(captured.activeShotId);
    expect(recaptured?.shots).toHaveLength(2);
  });

  it("requires the exact bundle set, a single scene anchor, matching Stage hash, and active scene shot", () => {
    const { document, elements, stage, scene } = materializedLink();
    const input = { value: document, elements, shared3dStage: stage } as const;

    expect(validateStudioLinked3dRenderDocumentAgainstPage(input)).toMatchObject({ ok: true });
    expect(validateStudioLinked3dRenderDocumentAgainstPage({
      ...input,
      elements: [...elements, {
        ...elements[0]!,
        id: "bundle-a-extra-color",
        bg3dLtRole: "color",
      }],
    })).toMatchObject({ ok: false, code: "invalid-layer" });
    expect(validateStudioLinked3dRenderDocumentAgainstPage({
      ...input,
      elements: [...elements, {
        id: "bundle-a-impostor",
        type: "text",
        bg3dLtBundleId: "bundle-a",
      }],
    })).toMatchObject({ ok: false, code: "invalid-layer" });
    expect(validateStudioLinked3dRenderDocumentAgainstPage({
      ...input,
      elements: elements.map((element) => ({ ...element, bg3dScene: undefined })),
    })).toMatchObject({ ok: false, code: "missing-scene-anchor" });
    expect(validateStudioLinked3dRenderDocumentAgainstPage({
      ...input,
      elements: elements.map((element) =>
        element.id === "bundle-a-tone" ? { ...element, bg3dScene: scene } : element),
    })).toMatchObject({ ok: false, code: "ambiguous-scene-anchor" });
    expect(validateStudioLinked3dRenderDocumentAgainstPage({
      ...input,
      shared3dStage: undefined,
    })).toMatchObject({ ok: false, code: "missing-stage" });
    expect(validateStudioLinked3dRenderDocumentAgainstPage({
      ...input,
      value: {
        ...document,
        links: [{ ...onlyLink(document), shotId: "shot-not-active" }],
      },
    })).toMatchObject({ ok: false, code: "missing-shot" });
    expect(parseStudioLinked3dRenderDocument({
      ...document,
      links: [{
        ...onlyLink(document),
        layers: onlyLink(document).layers.filter(({ role }) => role !== "main-line"),
      }],
    })).toBeNull();
  });

  it("marks an artist correction conflicted when the exact line pass revision changes", () => {
    const { document, stage, scene, passRevision } = materializedLink();
    const provenance = createStudioLinked3dCorrectionProvenance(document, "bundle-a-main-line");
    expect(provenance).not.toBeNull();
    const draw = {
      id: "artist-correction-pass-lineage",
      type: "draw",
      linked3dCorrection: provenance!,
    } satisfies StudioLinked3dRenderElementLike;
    const nextPass = createStudioLinked3dPassRevisionFixture(
      scene,
      stage.background.sourceHash,
      { revision: passRevision.revision + 1, contentHash: `sha256:${"e".repeat(64)}` },
    );
    const nextElements = [...linkedElements(scene, "bundle-a", nextPass), draw];
    const nextDocument = upsertStudioLinked3dRenderLink({
      value: document,
      bundleId: "bundle-a",
      shotId: scene.activeShotId!,
      passRevision: nextPass,
      elements: nextElements,
      shared3dStage: stage,
    });

    expect(onlyLink(nextDocument!).corrections).toEqual([expect.objectContaining({
      elementId: draw.id,
      appliedPassRevision: null,
      status: "conflict",
      conflictCode: "pass-revision-changed",
    })]);
  });

  it("rejects a persisted scene whose active Shot ID survives after the live view changes", () => {
    const { document, scene } = materializedLink();
    const changedScene = {
      ...scene,
      camera: {
        ...scene.camera,
        target: [
          scene.camera.target[0],
          scene.camera.target[1] + 1,
          scene.camera.target[2],
        ],
      },
    } satisfies StudioBg3dSceneDocument;
    const provisionalElements = linkedElements(changedScene);
    const provisionalStage = createStage(provisionalElements);
    const changedPass = createStudioLinked3dPassRevisionFixture(
      changedScene,
      provisionalStage.background.sourceHash,
    );
    const elements = linkedElements(changedScene, "bundle-a", changedPass);
    const stage = createStage(elements);
    const staleReceipt = {
      ...document,
      links: [{
        ...onlyLink(document),
        stageSourceHash: stage.background.sourceHash,
        passRevision: changedPass,
      }],
    };

    expect(validateStudioLinked3dRenderDocumentAgainstPage({
      value: staleReceipt,
      elements,
      shared3dStage: stage,
    })).toMatchObject({ ok: false, code: "missing-shot" });
  });

  it("preserves an existing DCC sourceShotId when an upsert refresh omits it", () => {
    const { scene, elements, stage, passRevision, document } = materializedLink({
      sourceShotId: "dcc-shot-1",
      dccSource: true,
    });

    const updated = upsertStudioLinked3dRenderLink({
      value: document,
      bundleId: "bundle-a",
      shotId: scene.activeShotId!,
      passRevision,
      elements,
      shared3dStage: stage,
    });

    expect(updated).not.toBeNull();
    expect(onlyLink(updated!).sourceShotId).toBe("dcc-shot-1");
    expect(onlyLink(updated!).layers).toEqual(onlyLink(document).layers);

    const secondShotScene = captureStudioBg3dShot(scene, {
      id: "shot-canvas-2",
      name: "Canvas linked shot 2",
    });
    expect(secondShotScene).not.toBeNull();
    const provisionalSecondElements = linkedElements(secondShotScene!);
    const provisionalSecondStage = createStage(provisionalSecondElements, "bundle-a", true);
    const secondPassRevision = createStudioLinked3dPassRevisionFixture(
      secondShotScene!,
      provisionalSecondStage.background.sourceHash,
      { revision: passRevision.revision + 1, contentHash: `sha256:${"c".repeat(64)}` },
    );
    const secondElements = linkedElements(secondShotScene!, "bundle-a", secondPassRevision);
    const secondStage = createStage(secondElements, "bundle-a", true);
    const movedToDifferentShot = upsertStudioLinked3dRenderLink({
      value: document,
      bundleId: "bundle-a",
      shotId: secondShotScene!.activeShotId!,
      passRevision: secondPassRevision,
      elements: secondElements,
      shared3dStage: secondStage,
    });
    expect(onlyLink(movedToDifferentShot!).sourceShotId).toBeNull();

    const stageWithoutDccSource = createStage(elements);
    const invalidDccReceipt = upsertStudioLinked3dRenderLink({
      value: undefined,
      bundleId: "bundle-a",
      shotId: scene.activeShotId!,
      sourceShotId: "dcc-shot-1",
      passRevision,
      elements,
      shared3dStage: stageWithoutDccSource,
    });
    expect(invalidDccReceipt).toBeNull();
  });

  it("removes explicit bundles and reconciles only live layer receipts after Canvas mutation", () => {
    const { document, elements, stage } = materializedLink();

    expect(removeStudioLinked3dRenderLinks(document, ["other-bundle"])).toEqual(document);
    expect(removeStudioLinked3dRenderLinks(document, ["bundle-a"])).toBeUndefined();

    const missingTone = elements.filter(({ bg3dLtRole }) => bg3dLtRole !== "tone");
    const reconciled = reconcileStudioLinked3dRenderDocumentAfterElementMutation({
      value: document,
      elements: missingTone,
      shared3dStage: stage,
    });
    expect(reconciled).not.toBeNull();
    expect(reconciled).not.toBeUndefined();
    expect(onlyLink(reconciled!).layers.map(({ role }) => role)).toEqual([
      "texture-line",
      "main-line",
    ]);
    expect(reconcileStudioLinked3dRenderDocumentAfterElementMutation({
      value: document,
      elements: [],
      shared3dStage: stage,
    })).toBeUndefined();
  });

  it("rejects orphan reserved locators and detaches visible corrections when a link retires", () => {
    const { document, elements, stage, scene, passRevision } = materializedLink();
    const provenance = createStudioLinked3dCorrectionProvenance(document, "bundle-a-main-line");
    expect(provenance).not.toBeNull();
    const draw = {
      id: "artist-correction-1",
      type: "draw",
      linked3dCorrection: provenance!,
    } satisfies StudioLinked3dRenderElementLike;
    const elementsWithCorrection = [...elements, draw];
    const documentWithCorrection = upsertStudioLinked3dRenderLink({
      value: document,
      bundleId: "bundle-a",
      shotId: scene.activeShotId!,
      passRevision,
      elements: elementsWithCorrection,
      shared3dStage: stage,
    });
    expect(documentWithCorrection).not.toBeNull();
    expect(validateStudioLinked3dReservedPageState({
      value: documentWithCorrection,
      elements: elementsWithCorrection,
    })).toMatchObject({ ok: true });

    const detached = detachStudioLinked3dCorrections(elementsWithCorrection, ["bundle-a"]);
    expect(detached).not.toBeNull();
    expect(detached?.find(({ id }) => id === draw.id)?.linked3dCorrection).toBeUndefined();
    expect(validateStudioLinked3dReservedPageState({
      value: undefined,
      elements: detached!.filter(({ id }) => id !== "bundle-a-main-line"),
    })).toMatchObject({ ok: true, document: undefined });
    expect(validateStudioLinked3dReservedPageState({
      value: undefined,
      elements: elementsWithCorrection,
    })).toMatchObject({ ok: false, code: "pass-integrity-mismatch" });
    expect(validateStudioLinked3dReservedPageState({
      value: documentWithCorrection,
      elements: [...elementsWithCorrection, {
        id: "orphan-linked-raster",
        type: "image",
        src: passRevision.artifact.locator,
      }],
    })).toMatchObject({ ok: false, code: "pass-integrity-mismatch" });
    expect(validateStudioLinked3dReservedPageState({
      value: documentWithCorrection,
      elements: elementsWithCorrection.map((element) =>
        element.id === "bundle-a-tone"
          ? { ...element, maskSrc: passRevision.artifact.locator }
          : element),
    })).toMatchObject({ ok: false, code: "pass-integrity-mismatch" });
  });

  it("remaps every generated Canvas element receipt without changing bundle or shot authority", () => {
    const { document } = materializedLink();
    const remapped = remapStudioLinked3dRenderDocumentElementIds(document, new Map([
      ["bundle-a-tone", "copy-tone"],
      ["bundle-a-texture-line", "copy-texture-line"],
      ["bundle-a-main-line", "copy-main-line"],
    ]));

    expect(remapped).not.toBeNull();
    expect(onlyLink(remapped!).bundleId).toBe("bundle-a");
    expect(onlyLink(remapped!).shotId).toBe("shot-canvas");
    expect(onlyLink(remapped!).layers.map(({ elementId }) => elementId)).toEqual([
      "copy-tone",
      "copy-texture-line",
      "copy-main-line",
    ]);
    expect(remapStudioLinked3dRenderDocumentElementIds(document, new Map())).toBeNull();
  });

  it("rejects URLs, extra keys, duplicate identities, and a serialized document over its byte budget", () => {
    const { document } = materializedLink();
    const link = onlyLink(document);

    expect(parseStudioLinked3dRenderDocument({
      ...document,
      links: [{ ...link, stageSourceHash: "https://example.test/render" }],
    })).toBeNull();
    expect(parseStudioLinked3dRenderDocument({
      ...document,
      links: [{ ...link, sourceShotId: "data:text/plain,shot" }],
    })).toBeNull();
    expect(parseStudioLinked3dRenderDocument({
      ...document,
      links: [{ ...link, unexpectedUrl: "https://example.test" }],
    })).toBeNull();
    expect(parseStudioLinked3dRenderDocument({
      ...document,
      links: [{
        ...link,
        layers: [...link.layers, {
          elementId: "other-main-line",
          role: "main-line",
        }],
      }],
    })).toBeNull();
    expect(parseStudioLinked3dRenderDocument({
      ...document,
      links: [link, link],
    })).toBeNull();

    const pagedScaleLinks = Array.from({ length: 65 }, (_, index) => ({
      ...link,
      bundleId: `bundle-${index}`,
      shotId: `shot-${index}`,
      layers: link.layers.map(({ role }, layerIndex) => ({
        elementId: `layer-${index}-${layerIndex}`,
        role,
      })),
    }));
    expect(parseStudioLinked3dRenderDocument({
      kind: STUDIO_LINKED_3D_RENDER_DOCUMENT_KIND,
      version: STUDIO_LINKED_3D_RENDER_DOCUMENT_VERSION,
      authority: "studio-project-linked-3d-pass-index",
      links: pagedScaleLinks,
    })?.links).toHaveLength(65);

    const oversizedLinks = Array.from({ length: 512 }, (_, index) => ({
      ...link,
      bundleId: `bundle-${index}`,
      shotId: `shot-${index}`,
      layers: link.layers.map(({ role }, layerIndex) => ({
        elementId: `layer-${index}-${layerIndex}`,
        role,
      })),
    }));
    expect(parseStudioLinked3dRenderDocument({
      kind: STUDIO_LINKED_3D_RENDER_DOCUMENT_KIND,
      version: STUDIO_LINKED_3D_RENDER_DOCUMENT_VERSION,
      authority: "studio-project-linked-3d-pass-index",
      links: oversizedLinks,
    })).toBeNull();
  });
});
