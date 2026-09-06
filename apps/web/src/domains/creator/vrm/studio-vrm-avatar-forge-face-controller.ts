import * as THREE from "three";

import type { AvatarForgeFaceParams } from "./studio-vrm-avatar-forge";
import type { StudioVrmProportionMetrics } from "./studio-vrm-proportion-core";

export const STUDIO_VRM_AVATAR_FORGE_FACE_CONTROLLER_VERSION = 1 as const;

export type StudioVrmAvatarForgeFaceScale = readonly [number, number, number];

export type StudioVrmAvatarForgeFaceControllerStatus =
  | "released"
  | "applied"
  | "rejected"
  | "disposed";

export type StudioVrmAvatarForgeFaceControllerFailureCode =
  | "ambiguous-scale-source"
  | "missing-scale-source"
  | "invalid-scale"
  | "invalid-rig-revision"
  | "missing-head-node"
  | "apply-failed"
  | "disposed";

export type StudioVrmAvatarForgeFaceControllerSnapshot = Readonly<{
  kind: "studio-vrm-avatar-forge-face-controller";
  version: typeof STUDIO_VRM_AVATAR_FORGE_FACE_CONTROLLER_VERSION;
  status: StudioVrmAvatarForgeFaceControllerStatus;
  /** Increments only when controller-owned state or node transforms actually change. */
  stateRevision: number;
  rigRevision: number | null;
  scale: StudioVrmAvatarForgeFaceScale | null;
  nodeCount: number;
  failure: StudioVrmAvatarForgeFaceControllerFailureCode | null;
}>;

export type StudioVrmAvatarForgeFaceControllerDisposition =
  | "applied"
  | "unchanged"
  | "released"
  | "rejected"
  | "disposed";

export type StudioVrmAvatarForgeFaceControllerTransition = Readonly<{
  disposition: StudioVrmAvatarForgeFaceControllerDisposition;
  reason: StudioVrmAvatarForgeFaceControllerFailureCode | null;
  snapshot: StudioVrmAvatarForgeFaceControllerSnapshot;
}>;

export type StudioVrmAvatarForgeFaceControllerReplaceInput = Readonly<{
  rawHead: THREE.Object3D | null;
  normalizedHead: THREE.Object3D | null;
  /** Incremented by the model owner whenever the normalized humanoid is rebuilt. */
  rigRevision: number;
  /** Exactly one of face or scale must be supplied. */
  face?: AvatarForgeFaceParams;
  /** Exactly one of face or scale must be supplied. */
  scale?: StudioVrmAvatarForgeFaceScale;
}>;

export type StudioVrmAvatarForgeFaceController = Readonly<{
  replace: (
    input: StudioVrmAvatarForgeFaceControllerReplaceInput,
  ) => StudioVrmAvatarForgeFaceControllerTransition;
  release: () => StudioVrmAvatarForgeFaceControllerTransition;
  dispose: () => StudioVrmAvatarForgeFaceControllerTransition;
  getSnapshot: () => StudioVrmAvatarForgeFaceControllerSnapshot;
}>;

type ActiveFaceLease = {
  readonly rigRevision: number;
  readonly scale: StudioVrmAvatarForgeFaceScale;
  readonly entries: readonly Readonly<{
    node: THREE.Object3D;
    originalScale: THREE.Vector3;
  }>[];
};

/**
 * Preserves the exact v3 face-sculpt arithmetic used by StudioVrmAvatarForge.
 * Invalid results are rejected by the controller instead of reaching Three.js nodes.
 */
export function deriveStudioVrmAvatarForgeFaceScale(
  face: AvatarForgeFaceParams,
): StudioVrmAvatarForgeFaceScale {
  const height = face.headHeight * (0.72 + face.chinLength * 0.28);
  const width = face.headWidth * (1 + (face.cheekVolume - 0.35) * 0.03);
  return [width, height, face.headDepth];
}

/**
 * Reports the apparent head-unit ratio after the legacy face-sculpt Y scale is projected on top of
 * the rig-safe proportion receipt. The rig receipt remains the deformation authority; this view is
 * only for honest UI/capture metadata so a longer or shorter sculpted face is not mislabeled as the
 * untouched skeletal head ratio.
 */
export function resolveStudioVrmAvatarForgeVisualProportionMetrics(
  metrics: StudioVrmProportionMetrics,
  face: AvatarForgeFaceParams,
): StudioVrmProportionMetrics {
  const faceScaleY = deriveStudioVrmAvatarForgeFaceScale(face)[1];
  const visualHeadLength = metrics.headLength * faceScaleY;
  const visualTotalHeight = metrics.totalHeight - metrics.headLength + visualHeadLength;
  if (
    !Number.isFinite(visualHeadLength)
    || visualHeadLength <= 0
    || !Number.isFinite(visualTotalHeight)
    || visualTotalHeight <= 0
  ) return metrics;
  return Object.freeze({
    ...metrics,
    headLength: visualHeadLength,
    totalHeight: visualTotalHeight,
    headUnits: visualTotalHeight / visualHeadLength,
  });
}

function freezeScale(scale: StudioVrmAvatarForgeFaceScale): StudioVrmAvatarForgeFaceScale {
  return Object.freeze([scale[0], scale[1], scale[2]]) as StudioVrmAvatarForgeFaceScale;
}

function isValidScale(scale: readonly number[] | undefined): scale is StudioVrmAvatarForgeFaceScale {
  return Boolean(
    scale &&
      scale.length === 3 &&
      scale.every((value) => Number.isFinite(value) && value > 0),
  );
}

function sameScale(
  left: StudioVrmAvatarForgeFaceScale,
  right: StudioVrmAvatarForgeFaceScale,
) {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function uniqueHeadNodes(input: StudioVrmAvatarForgeFaceControllerReplaceInput) {
  return [...new Set([input.rawHead, input.normalizedHead].filter(
    (node): node is THREE.Object3D => node !== null,
  ))];
}

function sameNodes(active: ActiveFaceLease, nodes: readonly THREE.Object3D[]) {
  return active.entries.length === nodes.length &&
    active.entries.every(({ node }) => nodes.includes(node));
}

function safeUpdateMatrixWorld(nodes: readonly THREE.Object3D[]) {
  for (const node of nodes) {
    try {
      node.updateMatrixWorld(true);
    } catch {
      // Transform restoration is still authoritative even if a detached/disposed consumer throws
      // while refreshing matrices. The next scene-level update will propagate the exact values.
    }
  }
}

function makeSnapshot(input: Omit<StudioVrmAvatarForgeFaceControllerSnapshot, "kind" | "version">) {
  return Object.freeze({
    kind: "studio-vrm-avatar-forge-face-controller" as const,
    version: STUDIO_VRM_AVATAR_FORGE_FACE_CONTROLLER_VERSION,
    ...input,
    scale: input.scale ? freezeScale(input.scale) : null,
  });
}

function makeTransition(
  disposition: StudioVrmAvatarForgeFaceControllerDisposition,
  snapshot: StudioVrmAvatarForgeFaceControllerSnapshot,
  reason: StudioVrmAvatarForgeFaceControllerFailureCode | null = null,
) {
  return Object.freeze({ disposition, reason, snapshot });
}

/**
 * Owns one model's raw/normalized head-scale lease.
 *
 * Lifecycle contract: the model owner MUST call `release()` before a proportion runtime mutates or
 * rebuilds the rig. Otherwise a later cleanup would correctly restore this lease's old baseline and
 * could overwrite the proportion runtime's newer head scale. After the proportion transaction has
 * committed, call `replace()` with the new `rigRevision` and current raw/normalized head identities.
 *
 * `replace()` releases a non-identical previous lease before capturing the new baseline. Repeating
 * the exact same nodes, scale, and rig revision is a no-op, so React re-renders never compound scale.
 */
export function createStudioVrmAvatarForgeFaceController(): StudioVrmAvatarForgeFaceController {
  let active: ActiveFaceLease | null = null;
  let disposed = false;
  let stateRevision = 0;
  let snapshot = makeSnapshot({
    status: "released",
    stateRevision,
    rigRevision: null,
    scale: null,
    nodeCount: 0,
    failure: null,
  });

  const publish = (
    status: StudioVrmAvatarForgeFaceControllerStatus,
    options: Readonly<{
      rigRevision?: number | null;
      scale?: StudioVrmAvatarForgeFaceScale | null;
      nodeCount?: number;
      failure?: StudioVrmAvatarForgeFaceControllerFailureCode | null;
    }> = {},
  ) => {
    stateRevision += 1;
    snapshot = makeSnapshot({
      status,
      stateRevision,
      rigRevision: options.rigRevision ?? null,
      scale: options.scale ?? null,
      nodeCount: options.nodeCount ?? 0,
      failure: options.failure ?? null,
    });
    return snapshot;
  };

  const restoreActive = () => {
    const lease = active;
    active = null;
    if (!lease) return false;
    for (const { node, originalScale } of lease.entries) node.scale.copy(originalScale);
    safeUpdateMatrixWorld(lease.entries.map(({ node }) => node));
    return true;
  };

  const reject = (reason: StudioVrmAvatarForgeFaceControllerFailureCode) => {
    restoreActive();
    return makeTransition("rejected", publish("rejected", { failure: reason }), reason);
  };

  const replace = (input: StudioVrmAvatarForgeFaceControllerReplaceInput) => {
    if (disposed) return makeTransition("rejected", snapshot, "disposed");

    const hasFace = input.face !== undefined;
    const hasExplicitScale = input.scale !== undefined;
    if (hasFace === hasExplicitScale) {
      return reject(hasFace ? "ambiguous-scale-source" : "missing-scale-source");
    }

    const derivedScale = hasExplicitScale
      ? input.scale
      : deriveStudioVrmAvatarForgeFaceScale(input.face!);
    const scale = isValidScale(derivedScale) ? freezeScale(derivedScale) : null;
    const nodes = uniqueHeadNodes(input);
    const validRigRevision = Number.isSafeInteger(input.rigRevision) && input.rigRevision >= 0;

    if (
      scale &&
      validRigRevision &&
      active &&
      active.rigRevision === input.rigRevision &&
      sameScale(active.scale, scale) &&
      sameNodes(active, nodes)
    ) {
      return makeTransition("unchanged", snapshot);
    }

    // A different replacement always gives back the previous exact baseline first.
    restoreActive();
    if (!scale) return reject("invalid-scale");
    if (!validRigRevision) return reject("invalid-rig-revision");
    if (nodes.length === 0) return reject("missing-head-node");

    const entries = nodes.map((node) => ({
      node,
      originalScale: node.scale.clone(),
    }));
    try {
      for (const { node, originalScale } of entries) {
        const next = [
          originalScale.x * scale[0],
          originalScale.y * scale[1],
          originalScale.z * scale[2],
        ] as const;
        if (!next.every(Number.isFinite)) throw new Error("non-finite node scale");
        node.scale.set(...next);
      }
      for (const { node } of entries) node.updateMatrixWorld(true);
    } catch {
      for (const { node, originalScale } of entries) node.scale.copy(originalScale);
      safeUpdateMatrixWorld(entries.map(({ node }) => node));
      active = null;
      return makeTransition("rejected", publish("rejected", { failure: "apply-failed" }), "apply-failed");
    }

    active = { rigRevision: input.rigRevision, scale, entries };
    return makeTransition("applied", publish("applied", {
      rigRevision: input.rigRevision,
      scale,
      nodeCount: entries.length,
    }));
  };

  const release = () => {
    if (disposed) return makeTransition("unchanged", snapshot);
    if (!active && snapshot.status === "released") {
      return makeTransition("unchanged", snapshot);
    }
    restoreActive();
    return makeTransition("released", publish("released"));
  };

  const dispose = () => {
    if (disposed) return makeTransition("unchanged", snapshot);
    restoreActive();
    disposed = true;
    return makeTransition("disposed", publish("disposed"));
  };

  return Object.freeze({
    replace,
    release,
    dispose,
    getSnapshot: () => snapshot,
  });
}
