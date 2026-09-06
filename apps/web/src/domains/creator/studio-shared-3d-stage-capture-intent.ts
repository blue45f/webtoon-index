import type { StudioBackground3DInsertResult } from "./scene-3d/studio-3d-insert-contract";

export type StudioShared3dStageMutationKind = NonNullable<
  StudioBackground3DInsertResult["sharedStageMutation"]
>["kind"];

/**
 * Characters enter a capture only after an explicit connect/relink choice, or while refreshing a
 * Stage that already owns character links. A background-only Stage may expose candidates in the
 * editor, but merely reopening and updating it must never hide or claim those source layers.
 */
export function shouldCaptureStudioShared3dStageCharacters(input: {
  readonly mutationKind: StudioShared3dStageMutationKind;
  readonly targetHasLinkedCharacters: boolean;
}): boolean {
  return input.mutationKind === "connect"
    || input.mutationKind === "relink"
    || (input.mutationKind === "refresh" && input.targetHasLinkedCharacters);
}
