import type { StudioShared3dStageCollectionDocument } from "./studio-shared-3d-stage-collection";

/** Native plural fixture shared by the independent persistence gates. */
export function createNativePluralShared3dStageFixture():
StudioShared3dStageCollectionDocument {
  const hash = (character: string) =>
    `sha256:${character.repeat(64)}` as `sha256:${string}`;
  const sharedCharacter = {
    elementId: "character-native-shared",
    modelRuntimeKey: `character-native-shared:${hash("b")}`,
    sourceHash: hash("c"),
  } as const;
  const characterA = {
    ...sharedCharacter,
    placement: { position: [1, 0.25, -2], rotationY: 0.5 },
  } as const;
  const characterB = {
    ...sharedCharacter,
    placement: { position: [-4, 1, 3], rotationY: -1.2 },
  } as const;
  return {
    kind: "toonspectrum.studio-shared-3d-stage-collection",
    version: 3,
    authority: "page-shared-3d-stage-collection",
    stages: [
      {
        id: "stage-native-a",
        capturePolicy: "require-all-linked",
        background: { bundleId: "bundle-native-a", sourceHash: hash("a") },
        characters: [characterA],
        dccSource: {
          sourceDocumentId: "dcc-native-document",
          sourceStateHash: "dcc-native-state",
          sourceWorkspaceHash: hash("d"),
          sourceBridgeSetHash: "dcc-native-bridge-set",
          sourceCommandCount: 24,
          sourceBridgeCommandSequence: 17,
        },
      },
      {
        id: "stage-native-b",
        capturePolicy: "require-all-linked",
        background: { bundleId: "bundle-native-b", sourceHash: hash("b") },
        characters: [characterB],
      },
    ],
    visibilityReceipts: [
      {
        elementId: sharedCharacter.elementId,
        modelRuntimeKey: sharedCharacter.modelRuntimeKey,
      },
    ],
  };
}
