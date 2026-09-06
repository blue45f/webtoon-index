import { describe, expect, it } from "vitest";

import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./bg3d/studio-bg3d-scene-document";
import { createStudioShared3dSceneSessionFromElements } from "./studio-shared-3d-scene-bridge";
import {
  createStudioShared3dSceneSessionForStage,
  createStudioShared3dStageCollectionDocument,
  STUDIO_SHARED_3D_STAGE_COLLECTION_KIND,
  STUDIO_SHARED_3D_STAGE_COLLECTION_MAX_STAGES,
  STUDIO_SHARED_3D_STAGE_COLLECTION_PAGED_VERSION,
  STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION,
  findStudioShared3dStageEntryByBundleId,
  migrateStudioShared3dStageCollectionDocument,
  parseStudioShared3dStageCollectionDocument,
  planStudioShared3dStageCharacterPlacementUpdate,
  planStudioShared3dStageCollectionRemoval,
  planStudioShared3dStageCollectionUpsert,
  queryStudioShared3dStageCollectionPage,
  reconcileStudioShared3dStageVisibilityReceiptsAfterElementMutation,
  remapStudioShared3dStageCollectionElementIds,
  resolveStudioShared3dStageCollectionForBundle,
  serializeStudioShared3dStageCollectionDocument,
  studioShared3dStageEntryAsDocument,
} from "./studio-shared-3d-stage-collection";
import {
  STUDIO_SHARED_3D_STAGE_DOCUMENT_MAX_BYTES,
  createStudioShared3dStageDocument,
  type StudioShared3dStageElementSource,
} from "./studio-shared-3d-stage-document";
import {
  createStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
  serializeStudioVrmSceneDocument,
} from "./vrm/studio-vrm-scene-document";

function sceneElements(): StudioShared3dStageElementSource[] {
  return [
    {
      id: "background-a",
      type: "image",
      bg3dLtBundleId: "bundle-a",
      bg3dScene: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    },
    {
      id: "background-b",
      type: "image",
      bg3dLtBundleId: "bundle-b",
      bg3dScene: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    },
    {
      id: "character-a",
      type: "image",
      name: "주인공",
      vrmScene: createStudioVrmSceneDocument(),
    },
    {
      id: "character-b",
      type: "image",
      name: "친구",
      vrmScene: normalizeStudioVrmSceneDocument({
        ...createStudioVrmSceneDocument(),
        model: { ...createStudioVrmSceneDocument().model, name: "친구 모델" },
      }),
    },
    {
      id: "character-c",
      type: "image",
      name: "조연",
      vrmScene: normalizeStudioVrmSceneDocument({
        ...createStudioVrmSceneDocument(),
        model: { ...createStudioVrmSceneDocument().model, name: "조연 모델" },
      }),
    },
  ];
}

function hiddenElements(): StudioShared3dStageElementSource[] {
  return sceneElements().map((element) =>
    element.id.startsWith("character-") ? { ...element, hidden: true } : element);
}

function createStage(
  bundleId: "bundle-a" | "bundle-b",
  characterId: "character-a" | "character-b" | "character-c",
  elements: readonly StudioShared3dStageElementSource[] = hiddenElements(),
) {
  return createStudioShared3dStageDocument({
    backgroundBundleId: bundleId,
    elements,
    characterElementIds: [characterId],
    hiddenByStageElementIds: [characterId],
  })!;
}

describe("Studio Shared 3D Stage collection v3/v4", () => {
  it("strictly migrates one historical v1 Stage and centralizes its visibility receipt", () => {
    const legacy = createStage("bundle-a", "character-a");
    const migrated = migrateStudioShared3dStageCollectionDocument(legacy);

    expect(migrated).toMatchObject({
      kind: STUDIO_SHARED_3D_STAGE_COLLECTION_KIND,
      version: STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION,
      authority: "page-shared-3d-stage-collection",
      stages: [{
        id: "bundle-a",
        background: { bundleId: "bundle-a" },
        characters: [{ elementId: "character-a" }],
      }],
      visibilityReceipts: [{ elementId: "character-a" }],
    });
    expect(migrated?.stages[0]?.characters[0]).not.toHaveProperty("hiddenByStage");
    expect(Object.isFrozen(migrated)).toBe(true);
    expect(Object.isFrozen(migrated?.stages)).toBe(true);
    const serialized = serializeStudioShared3dStageCollectionDocument(legacy);
    expect(serialized).not.toBeNull();
    expect(serializeStudioShared3dStageCollectionDocument(JSON.parse(serialized!))).toBe(
      serialized,
    );

    const legacyPluralV2 = { ...migrated!, version: 2 as const };
    expect(parseStudioShared3dStageCollectionDocument(legacyPluralV2)).toBeNull();
    expect(migrateStudioShared3dStageCollectionDocument(legacyPluralV2)).toEqual(migrated);
  });

  it("keeps two backgrounds independent and resolves only the requested background", () => {
    const elements = hiddenElements();
    const first = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: createStage("bundle-a", "character-a", elements),
      elements,
    })!;
    const second = planStudioShared3dStageCollectionUpsert({
      value: first.nextState,
      stage: createStage("bundle-b", "character-b", elements),
      elements: first.nextElements,
    })!;

    expect(second.nextState?.stages.map(({ background }) => background.bundleId)).toEqual([
      "bundle-a",
      "bundle-b",
    ]);
    expect(second.nextState?.visibilityReceipts.map(({ elementId }) => elementId)).toEqual([
      "character-a",
      "character-b",
    ]);
    expect(resolveStudioShared3dStageCollectionForBundle(
      second.nextState,
      second.nextElements,
      "bundle-a",
    )).toMatchObject({
      phase: "ready",
      backgroundBundleId: "bundle-a",
      linkedCharacterElementIds: ["character-a"],
    });
    expect(resolveStudioShared3dStageCollectionForBundle(
      second.nextState,
      second.nextElements,
      "bundle-b",
    )).toMatchObject({
      phase: "ready",
      backgroundBundleId: "bundle-b",
      linkedCharacterElementIds: ["character-b"],
    });
  });

  it("refreshes a target in place and rejects a new Stage id that collides with a sibling", () => {
    const elements = hiddenElements();
    const first = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: createStage("bundle-a", "character-a", elements),
      elements,
    })!;
    const second = planStudioShared3dStageCollectionUpsert({
      value: first.nextState,
      stage: createStage("bundle-b", "character-b", elements),
      elements: first.nextElements,
    })!;
    const siblingBefore = second.nextState?.stages[1];
    const refreshed = planStudioShared3dStageCollectionUpsert({
      value: second.nextState,
      stage: createStage("bundle-a", "character-a", elements),
      elements: second.nextElements,
    })!;

    expect(refreshed.nextState?.stages.map(({ id }) => id)).toEqual([
      "bundle-a",
      "bundle-b",
    ]);
    expect(refreshed.nextState?.stages[1]).toEqual(siblingBefore);

    const crossIdCollection = parseStudioShared3dStageCollectionDocument({
      ...first.nextState,
      stages: [{ ...first.nextState?.stages[0], id: "bundle-b" }],
    })!;
    expect(planStudioShared3dStageCollectionUpsert({
      value: crossIdCollection,
      stage: createStage("bundle-b", "character-c", elements),
      elements,
    })).toBeNull();
    expect(crossIdCollection.stages).toHaveLength(1);
    expect(crossIdCollection.stages[0]?.background.bundleId).toBe("bundle-a");
  });

  it("removes one background without changing the other and restores only its exact source", () => {
    const elements = hiddenElements();
    const first = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: createStage("bundle-a", "character-a", elements),
      elements,
    })!;
    const second = planStudioShared3dStageCollectionUpsert({
      value: first.nextState,
      stage: createStage("bundle-b", "character-b", elements),
      elements: first.nextElements,
    })!;
    const removed = planStudioShared3dStageCollectionRemoval({
      value: second.nextState,
      bundleIds: ["bundle-b"],
      elements: second.nextElements,
    })!;

    expect(removed.nextState?.stages).toHaveLength(1);
    expect(removed.nextState?.stages[0]?.background.bundleId).toBe("bundle-a");
    expect(removed.restoredElementIds).toEqual(["character-b"]);
    expect(removed.nextElements.find(({ id }) => id === "character-a")?.hidden).toBe(true);
    expect(removed.nextElements.find(({ id }) => id === "character-b")?.hidden).toBe(false);
  });

  it("relinks one background to a new source while preserving its sibling and exact receipts", () => {
    const elements = hiddenElements();
    const first = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: createStage("bundle-a", "character-a", elements),
      elements,
    })!;
    const second = planStudioShared3dStageCollectionUpsert({
      value: first.nextState,
      stage: createStage("bundle-b", "character-b", elements),
      elements: first.nextElements,
    })!;
    const relinked = planStudioShared3dStageCollectionUpsert({
      value: second.nextState,
      stage: createStage("bundle-a", "character-c", elements),
      elements: second.nextElements,
    })!;

    expect(relinked.nextState?.stages).toHaveLength(2);
    expect(findStudioShared3dStageEntryByBundleId(
      relinked.nextState,
      "bundle-a",
    )?.characters.map(({ elementId }) => elementId)).toEqual(["character-c"]);
    expect(findStudioShared3dStageEntryByBundleId(
      relinked.nextState,
      "bundle-b",
    )?.characters.map(({ elementId }) => elementId)).toEqual(["character-b"]);
    expect(relinked.nextState?.visibilityReceipts.map(({ elementId }) => elementId).sort())
      .toEqual(["character-b", "character-c"]);
    expect(relinked.restoredElementIds).toEqual(["character-a"]);
    expect(relinked.nextElements.find(({ id }) => id === "character-a")?.hidden).toBe(false);
    expect(relinked.nextElements.find(({ id }) => id === "character-b")?.hidden).toBe(true);
    expect(relinked.nextElements.find(({ id }) => id === "character-c")?.hidden).toBe(true);
  });

  it("keeps a background editable when its character connection is removed", () => {
    const elements = hiddenElements();
    const linked = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: createStage("bundle-a", "character-a", elements),
      elements,
    })!;
    const backgroundOnly = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-a",
      elements: linked.nextElements,
      characterElementIds: [],
      hiddenByStageElementIds: [],
      capturePolicy: "background-only",
    })!;
    const disconnected = planStudioShared3dStageCollectionUpsert({
      value: linked.nextState,
      stage: backgroundOnly,
      elements: linked.nextElements,
    })!;

    expect(disconnected.nextState).toMatchObject({
      stages: [{
        background: { bundleId: "bundle-a" },
        capturePolicy: "background-only",
        characters: [],
      }],
      visibilityReceipts: [],
    });
    expect(disconnected.restoredElementIds).toEqual(["character-a"]);
    expect(disconnected.nextElements.find(({ id }) => id === "character-a")?.hidden).toBe(false);
    expect(resolveStudioShared3dStageCollectionForBundle(
      disconnected.nextState,
      disconnected.nextElements,
      "bundle-a",
    )).toMatchObject({
      phase: "ready",
      message: "공유 3D 장면 · 배경만 연결됨",
      linkedCharacterElementIds: [],
    });
  });

  it("never unhides a replacement model on behalf of the old visibility receipt", () => {
    const elements = hiddenElements();
    const first = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: createStage("bundle-a", "character-a", elements),
      elements,
    })!;
    const base = createStudioVrmSceneDocument();
    const replaced = first.nextElements.map((element) =>
      element.id === "character-a"
        ? {
            ...element,
            vrmScene: normalizeStudioVrmSceneDocument({
              ...base,
              model: { ...base.model, name: "완전히 교체된 모델" },
            }),
          }
        : element);
    const removed = planStudioShared3dStageCollectionRemoval({
      value: first.nextState,
      bundleIds: ["bundle-a"],
      elements: replaced,
    })!;

    expect(removed.nextState).toBeUndefined();
    expect(removed.restoredElementIds).toEqual([]);
    expect(removed.nextElements.find(({ id }) => id === "character-a")?.hidden).toBe(true);
  });

  it("never acquires a new visibility receipt for an exact source that is still visible", () => {
    const visibleElements = sceneElements();
    const forgedStage = createStage("bundle-a", "character-a", hiddenElements());

    expect(planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: forgedStage,
      elements: visibleElements,
    })).toBeNull();
    expect(visibleElements.find(({ id }) => id === "character-a")?.hidden).not.toBe(true);
  });

  it("consumes Stage visibility ownership after a user reveal and preserves a later user hide", () => {
    const elements = hiddenElements();
    const linked = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: createStage("bundle-a", "character-a", elements),
      elements,
    })!;
    const manuallyRevealed = linked.nextElements.map((element) =>
      element.id === "character-a" ? { ...element, hidden: false } : element);
    const reconciled = reconcileStudioShared3dStageVisibilityReceiptsAfterElementMutation({
      value: linked.nextState,
      beforeElements: linked.nextElements,
      nextElements: manuallyRevealed,
    })!;
    expect(reconciled.consumedElementIds).toEqual(["character-a"]);
    expect(reconciled.nextState.visibilityReceipts).toEqual([]);

    const manuallyHiddenAgain = manuallyRevealed.map((element) =>
      element.id === "character-a" ? { ...element, hidden: true } : element);
    const removed = planStudioShared3dStageCollectionRemoval({
      value: reconciled.nextState,
      bundleIds: ["bundle-a"],
      elements: manuallyHiddenAgain,
    })!;
    expect(removed.restoredElementIds).toEqual([]);
    expect(removed.nextElements.find(({ id }) => id === "character-a")?.hidden).toBe(true);
  });

  it("shares one exact VRM across backgrounds while keeping each placement independent", () => {
    const elements = hiddenElements();
    const source = createStudioShared3dSceneSessionFromElements(elements)
      .characters.find(({ elementId }) => elementId === "character-a")!;
    const sourceSceneBefore = JSON.stringify(source.scene);
    const firstPlacement = { position: [1, 0.25, -2] as const, rotationY: 0.5 };
    const secondPlacement = { position: [-4, 1, 3] as const, rotationY: -1.2 };
    const first = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: createStage("bundle-a", "character-a", elements),
      elements,
      placementCaptures: [{
        elementId: source.elementId,
        expectedRuntimeKey: source.runtimeKey,
        transform: firstPlacement,
      }],
    })!;
    const second = planStudioShared3dStageCollectionUpsert({
      value: first.nextState,
      stage: createStage("bundle-b", "character-a", first.nextElements),
      elements: first.nextElements,
      placementCaptures: [{
        elementId: source.elementId,
        expectedRuntimeKey: source.runtimeKey,
        transform: secondPlacement,
      }],
    })!;

    expect(second.nextState?.stages.map((stage) =>
      stage.characters[0]?.placement)).toEqual([firstPlacement, secondPlacement]);
    expect(second.nextState?.visibilityReceipts).toHaveLength(1);
    expect(createStudioShared3dSceneSessionForStage(
      second.nextState,
      second.nextElements,
      "bundle-a",
    ).characters[0]).toMatchObject({
      elementId: "character-a",
      placementAuthority: "stage-override",
      stageTransform: firstPlacement,
    });
    expect(createStudioShared3dSceneSessionForStage(
      second.nextState,
      second.nextElements,
      "bundle-b",
    ).characters[0]?.stageTransform).toEqual(secondPlacement);

    const sharedPoseUpdate = second.nextElements.map((element) =>
      element.id === source.elementId && element.vrmScene
        ? {
            ...element,
            vrmScene: normalizeStudioVrmSceneDocument({
              ...element.vrmScene,
              expressions: { happy: 0.85 },
            }),
          }
        : element);
    const updatedPreview = createStudioShared3dSceneSessionForStage(
      second.nextState,
      sharedPoseUpdate,
      "bundle-a",
    ).characters[0]!;
    expect(updatedPreview.stageTransform).toEqual(firstPlacement);
    expect(updatedPreview.scene.expressions).toEqual({ happy: 0.85 });
    expect(updatedPreview.modelRuntimeKey).toBe(source.modelRuntimeKey);
    expect(updatedPreview.sourceHash).not.toBe(source.sourceHash);
    expect(resolveStudioShared3dStageCollectionForBundle(
      second.nextState,
      sharedPoseUpdate,
      "bundle-a",
    ).phase).toBe("live-update");

    const siblingBefore = second.nextState!.stages[1];
    const moved = planStudioShared3dStageCharacterPlacementUpdate({
      value: second.nextState,
      bundleId: "bundle-a",
      elements: second.nextElements,
      request: {
        elementId: source.elementId,
        expectedRuntimeKey: source.runtimeKey,
        expectedPlacementHash: createStudioShared3dSceneSessionForStage(
          second.nextState,
          second.nextElements,
          "bundle-a",
        ).characters[0]!.placementHash,
        transform: { position: [2, 0.5, -1], rotationY: 0.75 },
      },
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) throw new Error(moved.message);
    expect(moved.receipt).toMatchObject({
      authority: "stage-override",
      stageId: "bundle-a",
      beforeSourceHash: source.sourceHash,
      afterSourceHash: source.sourceHash,
      beforeRuntimeKey: source.runtimeKey,
      afterRuntimeKey: source.runtimeKey,
    });
    expect(moved.nextState.stages[1]).toEqual(siblingBefore);
    expect(JSON.stringify(
      second.nextElements.find(({ id }) => id === "character-a")?.vrmScene,
    )).toBe(sourceSceneBefore);

    const removedFirst = planStudioShared3dStageCollectionRemoval({
      value: moved.nextState,
      bundleIds: ["bundle-a"],
      elements: second.nextElements,
    })!;
    expect(removedFirst.restoredElementIds).toEqual([]);
    expect(removedFirst.nextElements.find(({ id }) => id === "character-a")?.hidden)
      .toBe(true);
    const removedLast = planStudioShared3dStageCollectionRemoval({
      value: removedFirst.nextState,
      bundleIds: ["bundle-b"],
      elements: removedFirst.nextElements,
    })!;
    expect(removedLast.restoredElementIds).toEqual(["character-a"]);
    expect(removedLast.nextElements.find(({ id }) => id === "character-a")?.hidden)
      .toBe(false);
  });

  it("rejects duplicate background identities and overflow while allowing shared sources", () => {
    const elements = hiddenElements();
    const firstStage = createStage("bundle-a", "character-a", elements);
    const first = migrateStudioShared3dStageCollectionDocument(firstStage)!;
    const duplicateBundle = {
      ...first,
      stages: [...first.stages, { ...first.stages[0], id: "other-stage" }],
    };
    expect(parseStudioShared3dStageCollectionDocument(duplicateBundle)).toBeNull();

    const secondEntry = {
      ...first.stages[0]!,
      id: "bundle-b",
      background: { ...first.stages[0]!.background, bundleId: "bundle-b" },
    };
    expect(parseStudioShared3dStageCollectionDocument({
      ...first,
      stages: [...first.stages, secondEntry],
    })).not.toBeNull();

    expect(parseStudioShared3dStageCollectionDocument({
      ...first,
      stages: Array.from(
        { length: STUDIO_SHARED_3D_STAGE_COLLECTION_MAX_STAGES + 1 },
        (_, index) => ({
          ...first.stages[0],
          id: `stage-${index}`,
          background: {
            ...first.stages[0]!.background,
            bundleId: `bundle-${index}`,
          },
          characters: [],
          capturePolicy: "background-only",
        }),
      ),
      visibilityReceipts: [],
    })).toBeNull();
  });

  it("round-trips 65 stages through two canonical pages without changing page authority", () => {
    const first = migrateStudioShared3dStageCollectionDocument(
      createStage("bundle-a", "character-a"),
    )!;
    const stages = Array.from({ length: STUDIO_SHARED_3D_STAGE_COLLECTION_MAX_STAGES + 1 },
      (_, index) => ({
        ...first.stages[0]!,
        id: `stage-${index}`,
        background: {
          ...first.stages[0]!.background,
          bundleId: `bundle-${index}`,
        },
        characters: [],
        capturePolicy: "background-only" as const,
      }));
    const paged = createStudioShared3dStageCollectionDocument({
      stages,
      visibilityReceipts: [],
    });

    expect(paged?.version).toBe(STUDIO_SHARED_3D_STAGE_COLLECTION_PAGED_VERSION);
    expect(paged?.stages).toHaveLength(65);
    if (!paged || paged.version !== STUDIO_SHARED_3D_STAGE_COLLECTION_PAGED_VERSION) {
      throw new Error("Expected paged shared 3D Stage fixture.");
    }
    expect(paged.stagePages.map((page) => page.items.length)).toEqual([64, 1]);
    expect(Object.keys(paged)).toEqual([
      "kind",
      "version",
      "authority",
      "stagePages",
      "visibilityReceiptPages",
    ]);

    const serialized = serializeStudioShared3dStageCollectionDocument(paged);
    const reopened = parseStudioShared3dStageCollectionDocument(JSON.parse(serialized!));
    expect(reopened?.stages.map((stage) => stage.id)).toEqual(stages.map((stage) => stage.id));
    expect(serializeStudioShared3dStageCollectionDocument(reopened)).toBe(serialized);

    const firstPage = queryStudioShared3dStageCollectionPage(reopened);
    if (!firstPage?.nextCursor) throw new Error("Expected a second shared 3D Stage page.");
    const secondPage = queryStudioShared3dStageCollectionPage(reopened, {
      cursor: firstPage.nextCursor,
    });
    expect(firstPage).toMatchObject({ pageIndex: 0, pageCount: 2, totalCount: 65 });
    expect(firstPage?.items).toHaveLength(64);
    expect(secondPage).toMatchObject({ pageIndex: 1, pageCount: 2, totalCount: 65 });
    expect(secondPage?.items).toHaveLength(1);
    expect(secondPage?.nextCursor).toBeNull();

    const changed = createStudioShared3dStageCollectionDocument({
      stages: stages.map((stage, index) => index === 0 ? { ...stage, id: "stage-replaced" } : stage),
      visibilityReceipts: [],
    });
    if (!firstPage) throw new Error("Expected a first shared 3D Stage page.");
    expect(queryStudioShared3dStageCollectionPage(changed, {
      cursor: firstPage.cursor,
    })).toBeNull();

    const changedOutsideFirstPage = createStudioShared3dStageCollectionDocument({
      stages: stages.map((stage, index) => index === 64
        ? {
            ...stage,
            id: "stage-last-page-replaced",
            background: { ...stage.background, bundleId: "bundle-last-page-replaced" },
          }
        : stage),
      visibilityReceipts: [],
    });
    expect(queryStudioShared3dStageCollectionPage(changedOutsideFirstPage, {
      cursor: firstPage.cursor,
    })).toBeNull();

    const migratedBelowPagingThreshold = createStudioShared3dStageCollectionDocument({
      stages: stages.slice(0, 64),
      visibilityReceipts: [],
    });
    expect(migratedBelowPagingThreshold?.version).toBe(
      STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION,
    );
    expect(queryStudioShared3dStageCollectionPage(migratedBelowPagingThreshold, {
      cursor: firstPage.cursor,
    })).toBeNull();
  });

  it("accepts one full 12-character DCC entry between the historical 6 KiB and v2 8 KiB limits", () => {
    const safeText = (prefix: string, length: number) =>
      `${prefix}${"x".repeat(length - prefix.length)}`;
    const entry = {
      id: safeText("stage-", 128),
      capturePolicy: "require-all-linked",
      background: {
        bundleId: safeText("bundle-", 128),
        sourceHash: `sha256:${"a".repeat(64)}`,
      },
      characters: Array.from({ length: 12 }, (_, index) => {
        const elementId = safeText(`character-${index}-`, 128);
        return {
          elementId,
          modelRuntimeKey: `${elementId}:sha256:${"b".repeat(64)}`,
          sourceHash: `sha256:${"c".repeat(64)}`,
        };
      }),
      dccSource: {
        sourceDocumentId: safeText("document-", 160),
        sourceStateHash: safeText("state-", 160),
        sourceWorkspaceHash: `sha256:${"d".repeat(64)}`,
        sourceBridgeSetHash: safeText("bridge-", 160),
        sourceCommandCount: 999_999,
        sourceBridgeCommandSequence: 999_999,
      },
    };
    const entryBytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    expect(entryBytes).toBeGreaterThan(6 * 1024);
    expect(entryBytes).toBeLessThanOrEqual(STUDIO_SHARED_3D_STAGE_DOCUMENT_MAX_BYTES);

    const parsed = parseStudioShared3dStageCollectionDocument({
      kind: STUDIO_SHARED_3D_STAGE_COLLECTION_KIND,
      version: STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION,
      authority: "page-shared-3d-stage-collection",
      stages: [entry],
      visibilityReceipts: entry.characters.map(({ elementId, modelRuntimeKey }) => ({
        elementId,
        modelRuntimeKey,
      })),
    });
    expect(parsed?.stages[0]?.characters).toHaveLength(12);
    expect(parsed?.stages[0]?.dccSource).toEqual(entry.dccSource);
    const projected = studioShared3dStageEntryAsDocument(parsed, entry.background.bundleId);
    expect(projected?.characters).toHaveLength(12);
    expect(projected?.characters.every(({ hiddenByStage }) => hiddenByStage === true)).toBe(true);
    expect(remapStudioShared3dStageCollectionElementIds(
      parsed,
      new Map(entry.characters.map(({ elementId }, index) =>
        [elementId, `remapped-${index}`] as const)),
    )?.stages[0]?.characters).toHaveLength(12);
  });

  it("rejects malformed Unicode provenance before JSON escaping can evade the entry limit", () => {
    const valid = migrateStudioShared3dStageCollectionDocument(
      createStage("bundle-a", "character-a"),
    )!;
    expect(parseStudioShared3dStageCollectionDocument({
      ...valid,
      stages: [{
        ...valid.stages[0],
        dccSource: {
          sourceDocumentId: "\ud800",
          sourceStateHash: "state",
          sourceWorkspaceHash: `sha256:${"d".repeat(64)}`,
          sourceBridgeSetHash: "bridge",
          sourceCommandCount: 1,
          sourceBridgeCommandSequence: 1,
        },
      }],
    })).toBeNull();
  });

  it("fails closed for unknown keys and stateful collection accessors", () => {
    const valid = migrateStudioShared3dStageCollectionDocument(
      createStage("bundle-a", "character-a"),
    )!;
    expect(parseStudioShared3dStageCollectionDocument({ ...valid, future: true })).toBeNull();
    expect(parseStudioShared3dStageCollectionDocument({
      ...valid,
      stages: [{ ...valid.stages[0], id: "x".repeat(129) }],
    })).toBeNull();
    expect(parseStudioShared3dStageCollectionDocument({
      ...valid,
      visibilityReceipts: [{
        ...valid.visibilityReceipts[0],
        modelRuntimeKey: "x".repeat(201),
      }],
    })).toBeNull();
    expect(parseStudioShared3dStageCollectionDocument({
      ...valid,
      visibilityReceipts: [{ ...valid.visibilityReceipts[0], future: true }],
    })).toBeNull();

    let stageReads = 0;
    const accessorBacked = {
      ...valid,
      get stages() {
        stageReads += 1;
        return stageReads === 1 ? valid.stages : [];
      },
    };
    expect(parseStudioShared3dStageCollectionDocument(accessorBacked)).toEqual(valid);
    expect(stageReads).toBe(1);
  });

  it("rejects malformed placements and stale optimistic Stage edits without source mutation", () => {
    const elements = hiddenElements();
    const source = createStudioShared3dSceneSessionFromElements(elements)
      .characters.find(({ elementId }) => elementId === "character-a")!;
    const linked = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: createStage("bundle-a", "character-a", elements),
      elements,
      placementCaptures: [{
        elementId: source.elementId,
        expectedRuntimeKey: source.runtimeKey,
        transform: { position: [1, 2, 3], rotationY: 0.5 },
      }],
    })!;
    const stage = linked.nextState!.stages[0]!;
    expect(parseStudioShared3dStageCollectionDocument({
      ...linked.nextState,
      stages: [{
        ...stage,
        characters: [{
          ...stage.characters[0],
          placement: { position: [Number.NaN, 0, 0], rotationY: 0 },
        }],
      }],
    })).toBeNull();
    expect(parseStudioShared3dStageCollectionDocument({
      ...linked.nextState,
      stages: [{
        ...stage,
        characters: [{
          ...stage.characters[0],
          placement: { position: [11, 0, 0], rotationY: 0 },
        }],
      }],
    })).toBeNull();
    expect(parseStudioShared3dStageCollectionDocument({
      ...linked.nextState,
      stages: [{
        ...stage,
        characters: [{
          ...stage.characters[0],
          placement: { position: [0, 0, 0], rotationY: 0, future: true },
        }],
      }],
    })).toBeNull();

    const beforeSource = serializeStudioVrmSceneDocument(
      linked.nextElements.find(({ id }) => id === source.elementId)?.vrmScene,
    );
    const stale = planStudioShared3dStageCharacterPlacementUpdate({
      value: linked.nextState,
      bundleId: "bundle-a",
      elements: linked.nextElements,
      request: {
        elementId: source.elementId,
        expectedRuntimeKey: source.runtimeKey,
        expectedPlacementHash: `sha256:${"f".repeat(64)}`,
        transform: { position: [2, 2, 3], rotationY: 0.7 },
      },
    });
    expect(stale).toMatchObject({ ok: false, code: "stale-source" });
    expect(serializeStudioVrmSceneDocument(
      linked.nextElements.find(({ id }) => id === source.elementId)?.vrmScene,
    )).toBe(beforeSource);
  });

  it("remaps every character link, Stage placement and visibility receipt for duplication", () => {
    const elements = hiddenElements();
    const source = createStudioShared3dSceneSessionFromElements(elements)
      .characters.find(({ elementId }) => elementId === "character-a")!;
    const linked = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: createStage("bundle-a", "character-a", elements),
      elements,
      placementCaptures: [{
        elementId: source.elementId,
        expectedRuntimeKey: source.runtimeKey,
        transform: { position: [3, 0.5, -4], rotationY: 1.25 },
      }],
    })!;
    const remapped = remapStudioShared3dStageCollectionElementIds(linked.nextState, new Map([
      ["background-a", "background-copy"],
      ["character-a", "character-copy"],
    ]));
    expect(remapped).toMatchObject({
      stages: [{ characters: [{
        elementId: "character-copy",
        placement: { position: [3, 0.5, -4], rotationY: 1.25 },
      }] }],
      visibilityReceipts: [{
        elementId: "character-copy",
        modelRuntimeKey: expect.stringMatching(/^character-copy:sha256:/u),
      }],
    });
    expect(findStudioShared3dStageEntryByBundleId(remapped, "bundle-a")).not.toBeNull();
  });
});
