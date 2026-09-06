import type { StudioBg3dSceneDocument } from "./studio-bg3d-scene-document";
import type { StudioBg3dSharedCharacterGroundingResult } from "./studio-bg3d-shared-character-grounding";
import type {
  StudioShared3dCharacterSource,
  StudioShared3dCharacterRuntimeStatus,
  StudioShared3dCharacterStageTransform,
  StudioShared3dSceneSession,
} from "../studio-shared-3d-scene-bridge";
import type { StudioShared3dStageResolution } from "../studio-shared-3d-stage-document";

export type StudioBg3dSharedStageMutationKind =
  | "background-only"
  | "connect"
  | "refresh"
  | "relink"
  | "unlink";

export type StudioBg3dSharedStageMaterializationKind =
  | "editable-lt-bundle"
  | "detached-editable-composite";

export interface StudioBg3dSharedStageEditorSessionInput {
  readonly open: boolean;
  /** Page + target-bundle ownership scope supplied by the Studio composition boundary. */
  readonly scopeKey: string;
  readonly initialDataUrl?: string;
  readonly initialScene?: StudioBg3dSceneDocument;
  readonly operation: "insert" | "update";
  readonly sceneSession?: StudioShared3dSceneSession;
  readonly stageResolution?: StudioShared3dStageResolution;
}

export interface StudioBg3dSharedStageEditorState {
  readonly sessionIdentity: string;
  /** Exact background source tokens prevent an unlinked draft from crossing editor targets. */
  readonly initialDataUrl?: string;
  readonly initialScene?: StudioBg3dSceneDocument;
  readonly operation: "insert" | "update";
  readonly placements: ReadonlyMap<string, StudioShared3dCharacterStageTransform>;
  readonly statuses: Readonly<Record<string, StudioShared3dCharacterRuntimeStatus>>;
  readonly groundings: Readonly<
    Record<string, StudioBg3dSharedCharacterGroundingResult>
  >;
  readonly mutationKind: StudioBg3dSharedStageMutationKind;
  readonly materializationKind: StudioBg3dSharedStageMaterializationKind;
  readonly selectedElementId: string | null;
}

export type StudioBg3dSharedStageEditorStateUpdater = (
  current: StudioBg3dSharedStageEditorState,
) => StudioBg3dSharedStageEditorState;

function characterSessionIdentity(character: StudioShared3dCharacterSource) {
  return Object.freeze({
    elementId: character.elementId,
    sourceHash: character.sourceHash,
    modelRuntimeKey: character.modelRuntimeKey,
    runtimeKey: character.runtimeKey,
    placementHash: character.placementHash,
    stageId: character.stageId ?? null,
    stageTransform: Object.freeze({
      position: Object.freeze([...character.stageTransform.position]),
      rotationY: character.stageTransform.rotationY,
    }),
  });
}

/**
 * Returns a compact, deterministic identity for the linked sources and exact persisted Stage.
 * Character scene documents and model bytes are deliberately omitted: their canonical hashes and
 * runtime keys already provide the authority/revision boundary without copying large payloads.
 */
export function studioBg3dSharedStageEditorSessionIdentity(
  input: StudioBg3dSharedStageEditorSessionInput,
): string {
  const resolution = input.stageResolution;
  return JSON.stringify({
    version: 1,
    open: input.open,
    scopeKey: input.scopeKey,
    operation: input.operation,
    session: input.sceneSession
      ? {
          kind: input.sceneSession.kind,
          version: input.sceneSession.version,
          authority: input.sceneSession.authority,
          omittedCharacterCount: input.sceneSession.omittedCharacterCount,
          characters: input.sceneSession.characters.map(characterSessionIdentity),
        }
      : null,
    resolution: resolution
      ? {
          phase: resolution.phase,
          backgroundBundleId: resolution.backgroundBundleId,
          backgroundElementId: resolution.backgroundElementId,
          linkedCharacterElementIds: resolution.linkedCharacterElementIds,
          updatedCharacterElementIds: resolution.updatedCharacterElementIds,
          missingCharacterElementIds: resolution.missingCharacterElementIds,
          replacedCharacterElementIds: resolution.replacedCharacterElementIds,
        }
      : null,
  });
}

function authoritativePlacements(
  characters: readonly StudioShared3dCharacterSource[],
): ReadonlyMap<string, StudioShared3dCharacterStageTransform> {
  return new Map(characters.map((character) => [
    character.elementId,
    character.stageTransform,
  ] as const));
}

export function createStudioBg3dSharedStageEditorState(
  input: StudioBg3dSharedStageEditorSessionInput,
): StudioBg3dSharedStageEditorState {
  const characters = input.sceneSession?.characters ?? [];
  return Object.freeze({
    sessionIdentity: studioBg3dSharedStageEditorSessionIdentity(input),
    initialDataUrl: input.initialDataUrl,
    initialScene: input.initialScene,
    operation: input.operation,
    placements: authoritativePlacements(characters),
    statuses: Object.freeze({}),
    groundings: Object.freeze({}),
    mutationKind: input.stageResolution?.backgroundBundleId
      ? "refresh"
      : characters.length > 0
        ? "connect"
        : "background-only",
    materializationKind: "editable-lt-bundle",
    selectedElementId: characters[0]?.elementId ?? null,
  });
}

export function isStudioBg3dSharedStageEditorStateCurrent(
  state: StudioBg3dSharedStageEditorState,
  input: StudioBg3dSharedStageEditorSessionInput,
): boolean {
  return state.operation === input.operation
    && state.initialDataUrl === input.initialDataUrl
    && state.initialScene === input.initialScene
    && state.sessionIdentity === studioBg3dSharedStageEditorSessionIdentity(input);
}

/**
 * Fail closed on the first render after a target/source change. React's later layout reset is for
 * transient UI state; this resolver makes sure an old placement is never rendered or captured in
 * that intervening commit.
 */
export function resolveStudioBg3dSharedStageEditorState(
  state: StudioBg3dSharedStageEditorState,
  input: StudioBg3dSharedStageEditorSessionInput,
): StudioBg3dSharedStageEditorState {
  return isStudioBg3dSharedStageEditorStateCurrent(state, input)
    ? state
    : createStudioBg3dSharedStageEditorState(input);
}

/** Old lazy VRM callbacks are ignored after their session has been replaced. */
export function updateStudioBg3dSharedStageEditorStateForSession(
  state: StudioBg3dSharedStageEditorState,
  expectedSessionIdentity: string,
  updater: StudioBg3dSharedStageEditorStateUpdater,
): StudioBg3dSharedStageEditorState {
  if (state.sessionIdentity !== expectedSessionIdentity) return state;
  const next = updater(state);
  return next.sessionIdentity === expectedSessionIdentity ? Object.freeze(next) : state;
}

/**
 * Admits callbacks emitted during the one commit in which props already describe a new session but
 * React has not synchronized its stored envelope yet. A callback from an older committed render
 * cannot roll a newer state back because its observed identity no longer matches `state`.
 */
export function updateStudioBg3dSharedStageEditorStateFromEffectiveSession(
  state: StudioBg3dSharedStageEditorState,
  observedStoredSessionIdentity: string,
  effectiveState: StudioBg3dSharedStageEditorState,
  updater: StudioBg3dSharedStageEditorStateUpdater,
): StudioBg3dSharedStageEditorState {
  const expectedSessionIdentity = effectiveState.sessionIdentity;
  const admitted = state.sessionIdentity === expectedSessionIdentity
    ? state
    : state.sessionIdentity === observedStoredSessionIdentity
      ? effectiveState
      : null;
  return admitted
    ? updateStudioBg3dSharedStageEditorStateForSession(
        admitted,
        expectedSessionIdentity,
        updater,
      )
    : state;
}

export function updateStudioBg3dSharedStagePlacementForSession(
  state: StudioBg3dSharedStageEditorState,
  expectedSessionIdentity: string,
  elementId: string,
  transform: StudioShared3dCharacterStageTransform,
): StudioBg3dSharedStageEditorState {
  if (state.sessionIdentity !== expectedSessionIdentity) return state;
  const placements = new Map(state.placements);
  placements.set(elementId, transform);
  return Object.freeze({ ...state, placements });
}
