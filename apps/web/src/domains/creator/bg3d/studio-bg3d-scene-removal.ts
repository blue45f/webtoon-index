import {
  calculateStudioBg3dThreeReparentTransform,
  type StudioBg3dThreeHierarchyEntity,
  type StudioBg3dThreeLocalTransform,
} from "./studio-bg3d-three-hierarchy";

import type { BgCustomModelInstance } from "../studio-background-3d-model";
import type { BgPrimitive } from "../studio-background-3d-primitives";
import type {
  StudioBg3dSceneDocument,
  StudioBg3dSceneNode,
} from "./studio-bg3d-scene-document";

export interface StudioBg3dLiveSceneSnapshot {
  readonly primitives: readonly BgPrimitive[];
  readonly customModels: readonly BgCustomModelInstance[];
  readonly document: StudioBg3dSceneDocument;
}

export interface StudioBg3dSceneRemovalSuccess {
  readonly ok: true;
  readonly snapshot: {
    readonly primitives: BgPrimitive[];
    readonly customModels: BgCustomModelInstance[];
    readonly document: StudioBg3dSceneDocument;
  };
  readonly removedEntityIds: ReadonlySet<string>;
  readonly detachedEntityIds: ReadonlySet<string>;
}

export interface StudioBg3dSceneRemovalFailure {
  readonly ok: false;
  readonly reason: "detach-transform-unavailable";
  readonly entityId: string;
}

export type StudioBg3dSceneRemovalPlan =
  | StudioBg3dSceneRemovalSuccess
  | StudioBg3dSceneRemovalFailure;

export type StudioBg3dReparentTransformResolver = (
  entities: readonly StudioBg3dThreeHierarchyEntity[],
  entityId: string,
  nextParentId: string | null,
) => StudioBg3dThreeLocalTransform | null;

/**
 * Replays durable model-deletion receipts against a scene before runtime hydration.
 *
 * The original deletion preflight already proved each affected attachment can be detached without
 * changing retained children in that scene. Repeating the same deterministic hierarchy transform
 * after a modal/session replacement closes the final gap between an authoritative IndexedDB commit
 * and the React scene commit that the replacement intentionally discarded.
 */
export function planStudioBg3dDeletedAttachmentReconciliation(input: {
  readonly document: StudioBg3dSceneDocument;
  readonly attachmentIds: ReadonlySet<string>;
  readonly resolveReparentTransform?: StudioBg3dReparentTransformResolver;
}): StudioBg3dSceneRemovalPlan {
  let snapshot: StudioBg3dLiveSceneSnapshot = {
    primitives: [],
    customModels: [],
    document: input.document,
  };
  const removedEntityIds = new Set<string>();
  const detachedEntityIds = new Set<string>();
  for (const attachmentId of input.attachmentIds) {
    const plan = planStudioBg3dSceneEntityRemoval({
      snapshot,
      entityIds: new Set(),
      attachmentId,
      ...(input.resolveReparentTransform
        ? { resolveReparentTransform: input.resolveReparentTransform }
        : {}),
    });
    if (!plan.ok) return plan;
    snapshot = plan.snapshot;
    for (const entityId of plan.removedEntityIds) removedEntityIds.add(entityId);
    for (const entityId of plan.detachedEntityIds) detachedEntityIds.add(entityId);
  }
  return {
    ok: true,
    snapshot: {
      primitives: [],
      customModels: [],
      document: snapshot.document,
    },
    removedEntityIds,
    detachedEntityIds,
  };
}

function documentHierarchyEntity(node: StudioBg3dSceneNode): StudioBg3dThreeHierarchyEntity {
  return {
    id: node.id,
    parentId: node.parentId,
    position: node.transform.position,
    rotation: node.transform.rotation,
    scale: node.transform.scale,
  };
}

function planDetachedTransforms(
  entities: readonly StudioBg3dThreeHierarchyEntity[],
  removedIds: ReadonlySet<string>,
  resolveReparentTransform: StudioBg3dReparentTransformResolver,
): Map<string, StudioBg3dThreeLocalTransform> | StudioBg3dSceneRemovalFailure {
  const detached = new Map<string, StudioBg3dThreeLocalTransform>();
  for (const entity of entities) {
    if (removedIds.has(entity.id) || !entity.parentId || !removedIds.has(entity.parentId)) continue;
    const transform = resolveReparentTransform(entities, entity.id, null);
    if (!transform) {
      return {
        ok: false,
        reason: "detach-transform-unavailable",
        entityId: entity.id,
      };
    }
    detached.set(entity.id, transform);
  }
  return detached;
}

function patchRuntimeEntity<T extends BgPrimitive | BgCustomModelInstance>(
  entity: T,
  removedIds: ReadonlySet<string>,
  detached: ReadonlyMap<string, StudioBg3dThreeLocalTransform>,
): T | null {
  if (removedIds.has(entity.id)) return null;
  const transform = detached.get(entity.id);
  if (!transform) return entity;
  return {
    ...entity,
    parentId: null,
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

function patchDocumentNode(
  node: StudioBg3dSceneNode,
  detached: ReadonlyMap<string, StudioBg3dThreeLocalTransform>,
): StudioBg3dSceneNode {
  const transform = detached.get(node.id);
  if (!transform) return node;
  return {
    ...node,
    parentId: null,
    transform: {
      position: [...transform.position],
      rotation: [...transform.rotation],
      scale: [...transform.scale],
    },
  };
}

/**
 * Computes the complete scene update before any irreversible model-library mutation begins.
 * It never mutates the input and fails closed when detaching a retained child would introduce
 * shear or otherwise lose its exact world transform.
 */
export function planStudioBg3dSceneEntityRemoval(input: {
  readonly snapshot: StudioBg3dLiveSceneSnapshot;
  readonly entityIds: ReadonlySet<string>;
  /** Persistent model deletion also removes its logical attachment and stale document nodes. */
  readonly attachmentId?: string;
  readonly resolveReparentTransform?: StudioBg3dReparentTransformResolver;
}): StudioBg3dSceneRemovalPlan {
  const resolveReparentTransform = input.resolveReparentTransform
    ?? calculateStudioBg3dThreeReparentTransform;
  const runtimeRemovedIds = new Set(input.entityIds);
  const runtimeEntities: readonly (BgPrimitive | BgCustomModelInstance)[] = [
    ...input.snapshot.primitives,
    ...input.snapshot.customModels,
  ];
  const runtimeDetached = planDetachedTransforms(
    runtimeEntities,
    runtimeRemovedIds,
    resolveReparentTransform,
  );
  if (!(runtimeDetached instanceof Map)) return runtimeDetached;

  const documentRemovedIds = new Set(runtimeRemovedIds);
  if (input.attachmentId) {
    for (const node of input.snapshot.document.nodes) {
      if (node.kind === "model" && node.attachmentId === input.attachmentId) {
        documentRemovedIds.add(node.id);
      }
    }
  }
  const documentEntities = input.snapshot.document.nodes.map(documentHierarchyEntity);
  const documentDetached = planDetachedTransforms(
    documentEntities,
    documentRemovedIds,
    resolveReparentTransform,
  );
  if (!(documentDetached instanceof Map)) return documentDetached;

  const primitives = input.snapshot.primitives
    .map((entity) => patchRuntimeEntity(entity, runtimeRemovedIds, runtimeDetached))
    .filter((entity): entity is BgPrimitive => entity !== null);
  const customModels = input.snapshot.customModels
    .map((entity) => patchRuntimeEntity(entity, runtimeRemovedIds, runtimeDetached))
    .filter((entity): entity is BgCustomModelInstance => entity !== null);
  const nodes = input.snapshot.document.nodes
    .filter((node) => !documentRemovedIds.has(node.id))
    .map((node) => patchDocumentNode(node, documentDetached));
  const shots = input.snapshot.document.shots?.map((shot) => ({
    ...shot,
    ...(shot.nodeVisibility
      ? {
          nodeVisibility: shot.nodeVisibility.filter(
            (entry) => !documentRemovedIds.has(entry.nodeId),
          ),
        }
      : {}),
  }));
  const document: StudioBg3dSceneDocument = {
    ...input.snapshot.document,
    nodes,
    ...(shots ? { shots } : {}),
    ...(input.attachmentId
      ? {
          attachments: input.snapshot.document.attachments.filter(
            (attachment) => attachment.id !== input.attachmentId,
          ),
        }
      : {}),
  };

  return {
    ok: true,
    snapshot: { primitives, customModels, document },
    removedEntityIds: documentRemovedIds,
    detachedEntityIds: new Set([...runtimeDetached.keys(), ...documentDetached.keys()]),
  };
}

export async function preflightAndDeleteStudioBg3dPersistedModel(input: {
  readonly snapshot: StudioBg3dLiveSceneSnapshot;
  readonly storageModelId: string;
  readonly attachmentId?: string;
  readonly deletePersistedModel: (storageModelId: string) => Promise<void>;
  readonly resolveReparentTransform?: StudioBg3dReparentTransformResolver;
}): Promise<StudioBg3dSceneRemovalPlan> {
  const entityIds = new Set(
    input.snapshot.customModels
      .filter((instance) => instance.modelId === input.storageModelId)
      .map((instance) => instance.id),
  );
  const plan = planStudioBg3dSceneEntityRemoval({
    snapshot: input.snapshot,
    entityIds,
    ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}),
    ...(input.resolveReparentTransform
      ? { resolveReparentTransform: input.resolveReparentTransform }
      : {}),
  });
  if (!plan.ok) return plan;
  await input.deletePersistedModel(input.storageModelId);
  return plan;
}
