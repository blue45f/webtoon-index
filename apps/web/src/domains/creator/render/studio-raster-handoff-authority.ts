import type {
  StudioRasterOverlaySourceElement,
  StudioRasterOverlaySourceOperation,
} from "../live/studio-crdt-raster-ui-bridge";
import type { Tool } from "../studio-editor-tool-model";
import type { StudioWebGpuCommittedPlanGates } from "./studio-webgpu-committed-plan";
import type { StudioWebGpuViewportSurfacePlan } from "./studio-webgpu-viewport";

import { canonicalStudioRasterJson } from "@/shared/lib/studio-crdt-raster-ops";

/**
 * M2 gate slice: editor tools whose armed state may keep the raster handoff presented.
 *
 * "select" is the original idle slice. "hand" also qualifies because the pan tool draws no Konva
 * chrome — its grab cursor is a CSS cursor on the canvas host, never a Stage plane — and it
 * mutates no scene pixels. An active pan gesture is already fail-closed independently of this
 * predicate: native wrap scrolling revokes the raster authority synchronously before the React
 * viewport plan catches up (the same mechanism that keeps select-mode wheel/space panning safe),
 * and a marquee or selection started while the hand tool is armed re-asserts its own gate bit.
 *
 * "draw" and every future tool stay vetoed (fail closed) until the Konva interaction planes —
 * brush cursors, rulers, node handles — move to a shared top overlay contract that stacks above
 * the raster surface.
 */
export function isStudioRasterHandoffViewNavigationTool(tool: Tool): boolean {
  return tool === "select" || tool === "hand";
}

export interface StudioRasterHandoffCandidate {
  /** Exact presentation generation. A stale frame can never reuse this identity. */
  readonly authorityKey: string;
  /** Exact scene, gate and viewport identity supplied by the owning Studio render. */
  readonly baseKey: string;
  readonly generation: number;
  readonly operationIds: readonly string[];
  /** Exact raster event frontier proven by the replay frame. */
  readonly rasterLogSha256: string;
}

export interface StudioRasterHandoffBaseKeyInput {
  readonly pageId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly elements: readonly StudioRasterOverlaySourceElement[];
  readonly gates?: StudioWebGpuCommittedPlanGates;
  readonly viewport: StudioWebGpuViewportSurfacePlan | null;
}

const AUTHORITY_ELEMENT_KEYS = [
  "id",
  "type",
  "hidden",
  "kind",
  "mode",
  "points",
  "pressures",
  "stroke",
  "strokeWidth",
  "pressureModel",
  "materialPressureModel",
  "materialMinimumDiameterRatio",
  "paintModel",
  "opacity",
  "brush",
  "blendMode",
  "symmetry",
  "panelClip",
  "clipBelow",
  "maskSrc",
  "maskEnabled",
  "alphaLocked",
  "fill",
  "gradient",
  "pattern",
  "brushDynamics",
  "brushTip",
  "stampPipeline",
  "watercolorPipeline",
  "sampleSpacing",
  "groupId",
] as const;

function authorityElementSnapshot(
  element: StudioRasterOverlaySourceElement
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of AUTHORITY_ELEMENT_KEYS) {
    const value = element[key];
    if (value !== undefined) snapshot[key] = value;
  }
  return snapshot;
}

/**
 * Builds a collision-free canonical identity rather than a short non-cryptographic hash. The key
 * is intentionally exact: scene semantics, handoff gates and the viewport must all still match
 * before the redundant Konva vector can be hidden.
 */
export function createStudioRasterHandoffBaseKey(
  input: StudioRasterHandoffBaseKeyInput
): string {
  return canonicalStudioRasterJson({
    version: 1,
    pageId: input.pageId,
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    elements: input.elements.map(authorityElementSnapshot),
    gates: {
      exportActive: input.gates?.exportActive === true,
      masterEditActive: input.gates?.masterEditActive === true,
      editActive: input.gates?.editActive === true,
      specialDraftActive: input.gates?.specialDraftActive === true,
      postProcessingActive: input.gates?.postProcessingActive === true,
    },
    viewport: input.viewport
      ? {
          surface: input.viewport.surface,
          transform: input.viewport.transform,
        }
      : null,
  });
}

export function createStudioRasterHandoffAuthorityKey(input: {
  readonly baseKey: string;
  readonly generation: number;
  readonly rasterLogSha256: string;
  readonly sourceOperations: readonly StudioRasterOverlaySourceOperation[];
}): string {
  return canonicalStudioRasterJson({
    version: 1,
    baseKey: input.baseKey,
    generation: input.generation,
    rasterLogSha256: input.rasterLogSha256,
    sourceOperations: input.sourceOperations.map((operation) => ({
      operationId: operation.operationId,
      semanticParameters: operation.semanticParameters,
    })),
  });
}

export function isStudioRasterHandoffCandidateAuthorized(input: {
  readonly candidate: StudioRasterHandoffCandidate | null;
  readonly currentBaseKey: string;
  /** SHA-256 captured only after the same raster frontier crossed a server ACK barrier. */
  readonly authorizedRasterLogSha256: string | null;
  readonly blocked: boolean;
}): boolean {
  const candidate = input.candidate;
  if (
    input.blocked || !candidate || candidate.baseKey !== input.currentBaseKey ||
    candidate.authorityKey.length === 0 ||
    !/^[a-f0-9]{64}$/u.test(candidate.rasterLogSha256) ||
    candidate.rasterLogSha256 !== input.authorizedRasterLogSha256 ||
    !Number.isSafeInteger(candidate.generation) ||
    candidate.generation < 1 || candidate.operationIds.length === 0
  ) {
    return false;
  }
  const unique = new Set(candidate.operationIds);
  return unique.size === candidate.operationIds.length &&
    candidate.operationIds.every((operationId) => operationId.length > 0);
}

export function studioRasterAuthorizedOperationIds(input: {
  readonly candidate: StudioRasterHandoffCandidate | null;
  readonly currentBaseKey: string;
  readonly authorizedRasterLogSha256: string | null;
  readonly blocked: boolean;
}): ReadonlySet<string> {
  return isStudioRasterHandoffCandidateAuthorized(input)
    ? new Set(input.candidate!.operationIds)
    : new Set();
}

/**
 * Stage-only consumers cannot see pixels currently delegated to the DOM raster presenter. This
 * explicit stage-read operation revokes that delegation and asks the already-selected Konva
 * compatibility/export projection to paint before synchronous readback. It is not a response to a
 * renderer failure and never changes provider inside the captured operation. Keeping the ordering
 * in one helper prevents capture paths from repeating the animation-frame flattening bug.
 */
export function readStudioAuthoritativeStageFrame<T>(input: {
  readonly revokeRasterHandoff: () => void;
  readonly drawStage: () => void;
  readonly read: () => T;
}): T {
  input.revokeRasterHandoff();
  input.drawStage();
  return input.read();
}
