import { describe, expect, it } from "vitest";

import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./bg3d/studio-bg3d-scene-document";
import {
  STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
  STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
  createStudioShared3dStageDocument,
  parseStudioShared3dStageDocument,
  refreshStudioShared3dStageDocument,
  releaseStudioShared3dStageOwnedSourceVisibility,
  remapStudioShared3dStageDocumentElementIds,
  resolveStudioShared3dStageDocument,
  serializeStudioShared3dStageDocument,
  type StudioShared3dStageElementSource,
} from "./studio-shared-3d-stage-document";
import {
  createStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
} from "./vrm/studio-vrm-scene-document";

function elements(): StudioShared3dStageElementSource[] {
  return [
    {
      id: "background-1",
      type: "image",
      bg3dLtBundleId: "bundle-1",
      bg3dScene: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    },
    {
      id: "character-1",
      type: "image",
      name: "주인공",
      vrmScene: createStudioVrmSceneDocument(),
    },
    { id: "flat-image", type: "image" },
  ];
}

describe("Studio Shared Stage v1 document", () => {
  it("persists only canonical background, character and DCC provenance references", () => {
    const document = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: elements(),
      dccSource: {
        sourceDocumentId: "dcc-document-1",
        sourceStateHash: "state:abc",
        sourceWorkspaceHash: `sha256:${"a".repeat(64)}`,
        sourceBridgeSetHash: "bridge:def",
        sourceCommandCount: 12,
        sourceBridgeCommandSequence: 9,
      },
    });

    expect(document).toMatchObject({
      kind: STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
      version: STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
      authority: "page-background-with-linked-character-sources",
      capturePolicy: "require-all-linked",
      background: { bundleId: "bundle-1" },
      characters: [{
        elementId: "character-1",
        modelRuntimeKey: expect.stringMatching(/^character-1:sha256:/u),
      }],
      dccSource: {
        sourceDocumentId: "dcc-document-1",
        sourceWorkspaceHash: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(document?.background.sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(document?.characters[0]?.sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document?.characters)).toBe(true);
    const serialized = serializeStudioShared3dStageDocument(document);
    expect(serialized).not.toBeNull();
    expect(serializeStudioShared3dStageDocument(JSON.parse(serialized!))).toBe(serialized);
  });

  it("fails closed for future, unknown, duplicate, unsafe and hostile payloads", () => {
    const valid = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: elements(),
    })!;
    const invalid = [
      { ...valid, version: 2 },
      { ...valid, future: true },
      { ...valid, background: { ...valid.background, sourceHash: `sha256:${"A".repeat(64)}` } },
      { ...valid, background: { ...valid.background, bundleId: "__proto__" } },
      { ...valid, characters: [valid.characters[0], valid.characters[0]] },
      { ...valid, characters: [{ ...valid.characters[0], modelRuntimeKey: "character-1:bad" }] },
      { ...valid, capturePolicy: "background-only", characters: valid.characters },
      { ...valid, dccSource: { sourceDocumentId: "partial" } },
    ];
    for (const value of invalid) expect(parseStudioShared3dStageDocument(value)).toBeNull();

    const cyclic: Record<string, unknown> = { ...valid };
    cyclic.dccSource = cyclic;
    expect(parseStudioShared3dStageDocument(cyclic)).toBeNull();
    const accessor = Object.defineProperty({}, "kind", {
      enumerable: true,
      get: () => {
        throw new Error("hostile getter");
      },
    });
    expect(parseStudioShared3dStageDocument(accessor)).toBeNull();

    let policyReads = 0;
    let characterReads = 0;
    const accessorBacked = {
      ...valid,
      get capturePolicy() {
        policyReads += 1;
        return policyReads === 1 ? "require-all-linked" : "future-policy";
      },
      get characters() {
        characterReads += 1;
        return characterReads === 1 ? valid.characters : [...valid.characters, valid.characters[0]];
      },
    };
    expect(parseStudioShared3dStageDocument(accessorBacked)).toEqual(valid);
    expect(policyReads).toBe(1);
    expect(characterReads).toBe(1);

    let lengthReads = 0;
    const changingLength = new Proxy([...valid.characters], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 1 : 13;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(parseStudioShared3dStageDocument({
      ...valid,
      characters: changingLength,
    })).toBeNull();
  });

  it("resolves exact links and reports missing or stale sources without guessing", () => {
    const sourceElements = elements();
    const document = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: sourceElements,
    })!;
    expect(resolveStudioShared3dStageDocument(document, sourceElements)).toEqual({
      phase: "ready",
      backgroundBundleId: "bundle-1",
      backgroundElementId: "background-1",
      linkedCharacterElementIds: ["character-1"],
      updatedCharacterElementIds: [],
      missingCharacterElementIds: [],
      replacedCharacterElementIds: [],
      message: "공유 3D 장면 · 배경 1개 · 캐릭터 1명 연결됨",
    });

    const changedCharacter = normalizeStudioVrmSceneDocument({
      ...createStudioVrmSceneDocument(),
      pose: { ...createStudioVrmSceneDocument().pose, yOffset: 0.5 },
    });
    const stale = sourceElements.map((element) =>
      element.id === "character-1" ? { ...element, vrmScene: changedCharacter } : element);
    expect(resolveStudioShared3dStageDocument(document, stale)).toMatchObject({
      phase: "live-update",
      linkedCharacterElementIds: ["character-1"],
      updatedCharacterElementIds: ["character-1"],
      missingCharacterElementIds: [],
      replacedCharacterElementIds: [],
    });
    const baseCharacter = createStudioVrmSceneDocument();
    const replacedCharacter = normalizeStudioVrmSceneDocument({
      ...baseCharacter,
      model: { ...baseCharacter.model, name: "교체된 캐릭터 모델" },
    });
    const replaced = sourceElements.map((element) =>
      element.id === "character-1"
        ? { ...element, vrmScene: replacedCharacter }
        : element);
    expect(resolveStudioShared3dStageDocument(document, replaced)).toMatchObject({
      phase: "partial",
      linkedCharacterElementIds: [],
      updatedCharacterElementIds: [],
      missingCharacterElementIds: [],
      replacedCharacterElementIds: ["character-1"],
    });
    expect(resolveStudioShared3dStageDocument(
      document,
      sourceElements.filter(({ id }) => id !== "character-1"),
    )).toMatchObject({
      phase: "partial",
      missingCharacterElementIds: ["character-1"],
      replacedCharacterElementIds: [],
    });
    expect(resolveStudioShared3dStageDocument(
      document,
      sourceElements.filter(({ id }) => id !== "background-1"),
    )).toMatchObject({ phase: "missing-background" });
  });

  it("refreshes explicitly linked source hashes while retaining missing-link evidence", () => {
    const sourceElements = elements();
    const document = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: sourceElements,
    })!;
    const changedCharacter = normalizeStudioVrmSceneDocument({
      ...createStudioVrmSceneDocument(),
      expressions: { happy: 0.8 },
    });
    const changed = sourceElements.map((element) =>
      element.id === "character-1" ? { ...element, vrmScene: changedCharacter } : element);
    const refreshed = refreshStudioShared3dStageDocument(document, changed)!;
    expect(refreshed.characters[0]?.sourceHash).not.toBe(document.characters[0]?.sourceHash);
    expect(resolveStudioShared3dStageDocument(refreshed, changed).phase).toBe("ready");

    const missing = refreshStudioShared3dStageDocument(
      refreshed,
      changed.filter(({ id }) => id !== "character-1"),
    )!;
    expect(missing.characters).toEqual(refreshed.characters);
    expect(resolveStudioShared3dStageDocument(missing, changed.filter(({ id }) =>
      id !== "character-1")).phase).toBe("partial");
  });

  it("owns and releases only visibility changed by the Stage capture transaction", () => {
    const captured = elements().map((element) =>
      element.id === "character-1" ? { ...element, hidden: true } : element);
    const document = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: captured,
      characterElementIds: ["character-1"],
      hiddenByStageElementIds: ["character-1"],
    })!;

    expect(document.characters[0]).toMatchObject({
      elementId: "character-1",
      hiddenByStage: true,
    });
    const released = releaseStudioShared3dStageOwnedSourceVisibility(document, captured);
    expect(released.restoredElementIds).toEqual(["character-1"]);
    expect(released.nextElements.find(({ id }) => id === "character-1")?.hidden).toBe(false);
    expect(captured.find(({ id }) => id === "character-1")?.hidden).toBe(true);

    const userHiddenDocument = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: captured,
      characterElementIds: ["character-1"],
    })!;
    const userHiddenRelease = releaseStudioShared3dStageOwnedSourceVisibility(
      userHiddenDocument,
      captured,
    );
    expect(userHiddenRelease.restoredElementIds).toEqual([]);
    expect(userHiddenRelease.nextElements).toBe(captured);

    const base = createStudioVrmSceneDocument();
    const replaced = captured.map((element) =>
      element.id === "character-1"
        ? {
            ...element,
            vrmScene: normalizeStudioVrmSceneDocument({
              ...base,
              model: { ...base.model, name: "교체 모델" },
            }),
          }
        : element);
    const replacedRelease = releaseStudioShared3dStageOwnedSourceVisibility(
      document,
      replaced,
    );
    expect(replacedRelease.restoredElementIds).toEqual([]);
    expect(replacedRelease.nextElements).toBe(replaced);

    expect(createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: elements(),
      characterElementIds: ["character-1"],
      hiddenByStageElementIds: ["character-1"],
    })).toBeNull();
    expect(parseStudioShared3dStageDocument({
      ...document,
      characters: [{ ...document.characters[0], hiddenByStage: false }],
    })).toBeNull();
  });

  it("resolves receipt-linked characters before the runtime cast budget and rejects duplicate IDs", () => {
    const sourceElements = elements();
    const crowded = [
      sourceElements[0]!,
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `unrelated-${index + 1}`,
        type: "image",
        vrmScene: createStudioVrmSceneDocument(),
      })),
      sourceElements[1]!,
    ];
    const document = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: crowded,
      characterElementIds: ["character-1"],
    });
    expect(document?.characters.map(({ elementId }) => elementId)).toEqual(["character-1"]);
    expect(resolveStudioShared3dStageDocument(document, crowded)).toMatchObject({
      phase: "ready",
      linkedCharacterElementIds: ["character-1"],
    });

    const duplicate = [...sourceElements, { ...sourceElements[1] }];
    expect(createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: duplicate,
      characterElementIds: ["character-1"],
    })).toBeNull();
    const original = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: sourceElements,
      characterElementIds: ["character-1"],
    })!;
    expect(resolveStudioShared3dStageDocument(original, duplicate)).toMatchObject({
      phase: "partial",
      linkedCharacterElementIds: [],
      missingCharacterElementIds: ["character-1"],
    });
  });

  it("remaps every page-local link atomically for page duplication", () => {
    const document = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: elements(),
    })!;
    const remapped = remapStudioShared3dStageDocumentElementIds(document, new Map([
      ["background-1", "background-copy"],
      ["character-1", "character-copy"],
    ]));
    expect(remapped).toMatchObject({
      background: { bundleId: "bundle-1", sourceHash: document.background.sourceHash },
      characters: [{
        elementId: "character-copy",
        modelRuntimeKey: expect.stringMatching(/^character-copy:sha256:/u),
        sourceHash: document.characters[0]?.sourceHash,
      }],
    });
    expect(document.background.bundleId).toBe("bundle-1");
    expect(remapStudioShared3dStageDocumentElementIds(document, new Map([
      ["background-1", "background-copy"],
    ]))).toBeNull();
  });

  it("survives an LT scene-anchor promotion but rejects an ambiguous bundle", () => {
    const sourceElements = elements();
    const document = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-1",
      elements: sourceElements,
    })!;
    const promoted = sourceElements.map((element) =>
      element.id === "background-1"
        ? { ...element, id: "promoted-tone" }
        : element);
    expect(resolveStudioShared3dStageDocument(document, promoted)).toMatchObject({
      phase: "ready",
      backgroundBundleId: "bundle-1",
      backgroundElementId: "promoted-tone",
    });

    expect(resolveStudioShared3dStageDocument(document, [
      ...promoted,
      {
        id: "duplicate-anchor",
        type: "image",
        bg3dLtBundleId: "bundle-1",
        bg3dScene: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      },
    ])).toMatchObject({ phase: "ambiguous-background" });
  });
});
