/**
 * Product bridge for Blender-style, non-destructive Hybrid DCC modifier stacks.
 *
 * The editable half-edge mesh remains the authority. Stack edits are validated and committed as
 * document commands, while the evaluated mesh is stored only as a disposable render cache. Applying
 * the stack is an explicit atomic authority change and clears the stack in the same undo step.
 */

import { mutateStudioSharedObjectGeometry } from "../live/studio-live-2d3d-bridge";
import { studioEditableMeshToTriangleSoup } from "../studio-editable-half-edge-mesh";
import {
  contentAddressStudioGeometryBytes,
  materializeStudioGeometryRenderCache,
  type StudioGeometryAuthorityRecord,
} from "../studio-geometry-authority";
import {
  createStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  hashStudioMeshModifierStack,
  STUDIO_MESH_MODIFIER_STACK_LIMITS,
  type StudioMeshModifier,
  type StudioMeshModifierKind,
  type StudioMeshModifierStack,
} from "../studio-mesh-modifier-stack";
import { createStudioDefaultSolidBooleanBackend } from "../studio-solid-boolean-backend";

import {
  hybridDccApplyModifierStack,
  hybridDccSetModifierStack,
  type StudioHybridDccBooleanOperandEvaluationReceipt,
  type StudioHybridDccSession,
} from "./studio-hybrid-dcc-document";
import {
  hashStudioHybridDccObjectTransform,
  transformStudioHybridDccPoint,
  type StudioHybridDccObjectTransform,
  type StudioHybridDccVec3Tuple,
} from "./studio-hybrid-dcc-object-transform";
import {
  workspaceRedo,
  workspaceUndo,
  type StudioHybridDccWorkspace,
} from "./studio-hybrid-dcc-workspace";

export type StudioHybridDccModifierMoveDirection = "up" | "down";

export type StudioHybridDccModifierPatch = Readonly<Record<string, unknown>>;

export const STUDIO_HYBRID_DCC_MODIFIER_LABELS: Readonly<Record<
  StudioMeshModifierKind,
  string
>> = Object.freeze({
  mirror: "대칭",
  array: "반복 배열",
  boolean: "합치기·빼기",
  solidify: "두께",
  bevel: "모서리 둥글리기",
  subdivision: "세분화",
  weld: "버텍스 병합",
  decimate: "면수 축소",
  "simple-deform": "변형(비틀기·테이퍼)",
});

function activeRecord(workspace: StudioHybridDccWorkspace): StudioGeometryAuthorityRecord {
  const assetId = workspace.activeAssetId;
  if (!assetId) throw new Error("먼저 오브젝트를 선택하세요.");
  const record = workspace.session.state.geometry.records[assetId];
  if (!record) throw new Error("선택한 오브젝트의 원본 메시를 찾지 못했습니다.");
  return record;
}

function finiteNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function inverseTransformStudioHybridDccPoint(
  point: StudioHybridDccVec3Tuple,
  transform: StudioHybridDccObjectTransform,
): StudioHybridDccVec3Tuple {
  const [rx, ry, rz] = transform.rotationEulerRad;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const dx = point[0] - transform.position[0];
  const dy = point[1] - transform.position[1];
  const dz = point[2] - transform.position[2];

  // Inverse of Three.js XYZ order: Rx^-1 * Ry^-1 * Rz^-1, then inverse scale.
  const rzX = cz * dx + sz * dy;
  const rzY = -sz * dx + cz * dy;
  const ryX = cy * rzX - sy * dz;
  const ryZ = sy * rzX + cy * dz;
  const rxY = cx * rzY + sx * ryZ;
  const rxZ = -sx * rzY + cx * ryZ;
  return [
    ryX / transform.scale[0],
    rxY / transform.scale[1],
    rxZ / transform.scale[2],
  ];
}

function transformTriangleSoupIntoActiveLocalSpace(
  positions: Float32Array,
  indices: Uint32Array,
  cutterTransform: StudioHybridDccObjectTransform,
  activeTransform: StudioHybridDccObjectTransform,
): { readonly positions: Float32Array; readonly indices: Uint32Array } {
  const transformed = new Float32Array(positions.length);
  const coordinateLimit = STUDIO_MESH_MODIFIER_STACK_LIMITS.maxCoordinateMagnitude;
  for (let index = 0; index < positions.length; index += 3) {
    const world = transformStudioHybridDccPoint([
      positions[index]!,
      positions[index + 1]!,
      positions[index + 2]!,
    ], cutterTransform);
    const local = inverseTransformStudioHybridDccPoint(world, activeTransform);
    if (local.some((value) => !Number.isFinite(value) || Math.abs(value) > coordinateLimit)) {
      throw new Error("Boolean 커터 변환 결과가 안전한 좌표 범위를 벗어났습니다.");
    }
    transformed[index] = local[0];
    transformed[index + 1] = local[1];
    transformed[index + 2] = local[2];
  }
  const transformedIndices = new Uint32Array(indices);
  const cutterDeterminant = cutterTransform.scale.reduce((value, scale) => value * scale, 1);
  const activeDeterminant = activeTransform.scale.reduce((value, scale) => value * scale, 1);
  if (cutterDeterminant * activeDeterminant < 0) {
    for (let index = 0; index < transformedIndices.length; index += 3) {
      const second = transformedIndices[index + 1]!;
      transformedIndices[index + 1] = transformedIndices[index + 2]!;
      transformedIndices[index + 2] = second;
    }
  }
  return { positions: transformed, indices: transformedIndices };
}

async function resolveBooleanOperands(
  workspace: StudioHybridDccWorkspace,
  active: StudioGeometryAuthorityRecord,
  modifiers: readonly StudioMeshModifier[],
): Promise<{
  readonly modifiers: readonly StudioMeshModifier[];
  readonly receipts: readonly StudioHybridDccBooleanOperandEvaluationReceipt[];
}> {
  const activeTransform = workspace.session.state.objectTransforms[active.assetId];
  if (!activeTransform) throw new Error("선택한 오브젝트의 변환 정보를 찾지 못했습니다.");
  const backend = createStudioDefaultSolidBooleanBackend();
  const receipts: StudioHybridDccBooleanOperandEvaluationReceipt[] = [];
  const resolved: StudioMeshModifier[] = [];
  for (const modifier of modifiers) {
    if (modifier.kind !== "boolean" || !modifier.enabled || !modifier.operandAssetId) {
      resolved.push(modifier);
      continue;
    }
    if (modifier.operandAssetId === active.assetId) {
      throw new Error("Boolean 커터는 편집 중인 오브젝트와 달라야 합니다.");
    }
    const cutter = workspace.session.state.geometry.records[modifier.operandAssetId];
    const cutterTransform = workspace.session.state.objectTransforms[modifier.operandAssetId];
    if (!cutter || !cutterTransform) {
      throw new Error(`Boolean 커터 ${modifier.operandAssetId}를 찾지 못했습니다.`);
    }
    const cutterEvaluation = await evaluateStudioMeshModifierStack(cutter.modifierStack, {
      booleanBackend: backend,
    });
    if (!cutterEvaluation.ok) {
      throw new Error(
        `Boolean 커터 ${modifier.operandAssetId} 평가 실패 · ${cutterEvaluation.detail}`,
      );
    }
    const cutterSoup = studioEditableMeshToTriangleSoup(cutterEvaluation.value.mesh);
    const operand = transformTriangleSoupIntoActiveLocalSpace(
      cutterSoup.positions,
      cutterSoup.indices,
      cutterTransform,
      activeTransform,
    );
    resolved.push({ ...modifier, operand });
    receipts.push({
      modifierId: modifier.id,
      operation: modifier.operation,
      operandAssetId: modifier.operandAssetId,
      sourceMeshHash: cutter.meshHash,
      modifierStackHash: hashStudioMeshModifierStack(cutter.modifierStack),
      evaluatedMeshHash: cutterEvaluation.value.resultHash,
      objectTransformHash: hashStudioHybridDccObjectTransform(cutterTransform),
      resolvedOperandHash: contentAddressStudioGeometryBytes(
        operand.positions,
        operand.indices,
      ),
    });
  }
  return { modifiers: resolved, receipts };
}

function nextModifierId(stack: StudioMeshModifierStack, kind: StudioMeshModifierKind): string {
  const base = `modifier-${kind}`;
  if (!stack.modifiers.some(({ id }) => id === base)) return base;
  for (let suffix = 2; suffix <= 1_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!stack.modifiers.some(({ id }) => id === candidate)) return candidate;
  }
  throw new Error("변형 기록 수가 너무 많습니다. 일부 변형을 적용하거나 삭제해 주세요.");
}

function defaultModifier(
  workspace: StudioHybridDccWorkspace,
  record: StudioGeometryAuthorityRecord,
  kind: StudioMeshModifierKind,
): StudioMeshModifier {
  const id = nextModifierId(record.modifierStack, kind);
  switch (kind) {
    case "mirror":
      return {
        kind,
        id,
        enabled: true,
        axis: "x",
        merge: true,
        mergeThreshold: 0.0001,
        bisect: false,
        clip: false,
      };
    case "array":
      return {
        kind,
        id,
        enabled: true,
        count: 3,
        offset: { x: 1.25, y: 0, z: 0 },
        mode: "linear",
        radialAngleRad: Math.PI * 2,
        realizeInstances: true,
      };
    case "solidify":
      return {
        kind,
        id,
        enabled: true,
        thickness: 0.08,
        evenThickness: true,
        rim: true,
      };
    case "bevel":
      return {
        kind,
        id,
        enabled: true,
        amount: 0.08,
        // The exact evaluator currently ships one topology-safe cut. Do not create a default
        // stack the evaluator must reject or advertise approximate multi-segment geometry.
        segments: 1,
        angleLimitRad: Math.PI / 3,
        weightInfluence: 0,
      };
    case "boolean": {
      const operand = Object.values(workspace.session.state.geometry.records)
        .toSorted((left, right) => left.assetId < right.assetId ? -1 : 1)
        .find(({ assetId }) => assetId !== record.assetId);
      if (!operand) {
        throw new Error("합치거나 뺄 두 번째 오브젝트를 먼저 추가해 주세요.");
      }
      const soup = studioEditableMeshToTriangleSoup(operand.mesh);
      return {
        kind,
        id,
        enabled: true,
        operation: "difference",
        operandAssetId: operand.assetId,
        operand: {
          positions: new Float32Array(soup.positions),
          indices: new Uint32Array(soup.indices),
        },
      };
    }
    case "subdivision":
      return {
        kind,
        id,
        enabled: true,
        levels: 1,
        smooth: true,
      };
    case "weld":
      return {
        kind,
        id,
        enabled: true,
        quantum: 0.0001,
      };
    case "decimate":
      return {
        kind,
        id,
        enabled: true,
        ratio: 0.5,
      };
    case "simple-deform":
      return {
        kind,
        id,
        enabled: true,
        mode: "twist",
        axis: "y",
        angleRad: Math.PI / 4,
        factor: 1,
      };
  }
}

function patchModifier(
  workspace: StudioHybridDccWorkspace,
  activeAssetId: string,
  modifier: StudioMeshModifier,
  patch: StudioHybridDccModifierPatch,
): StudioMeshModifier {
  const enabled = booleanValue(patch.enabled, modifier.enabled);
  switch (modifier.kind) {
    case "mirror":
      return {
        ...modifier,
        enabled,
        axis: patch.axis === "x" || patch.axis === "y" || patch.axis === "z"
          ? patch.axis
          : modifier.axis,
        merge: booleanValue(patch.merge, modifier.merge),
        mergeThreshold: finiteNumber(
          patch.mergeThreshold,
          modifier.mergeThreshold,
          0,
          0.1,
        ),
        bisect: booleanValue(patch.bisect, modifier.bisect),
        clip: booleanValue(patch.clip, modifier.clip),
      };
    case "array": {
      const offset = patch.offset && typeof patch.offset === "object"
        ? patch.offset as Readonly<Record<string, unknown>>
        : {};
      return {
        ...modifier,
        enabled,
        count: Math.trunc(finiteNumber(patch.count, modifier.count, 1, 64)),
        offset: {
          x: finiteNumber(offset.x, modifier.offset.x, -1_000, 1_000),
          y: finiteNumber(offset.y, modifier.offset.y, -1_000, 1_000),
          z: finiteNumber(offset.z, modifier.offset.z, -1_000, 1_000),
        },
        mode: patch.mode === "linear" || patch.mode === "radial"
          ? patch.mode
          : modifier.mode,
        radialAngleRad: finiteNumber(
          patch.radialAngleRad,
          modifier.radialAngleRad ?? Math.PI * 2,
          -Math.PI * 8,
          Math.PI * 8,
        ),
        realizeInstances: booleanValue(patch.realizeInstances, modifier.realizeInstances),
      };
    }
    case "boolean": {
      const requestedOperandId = typeof patch.operandId === "string"
        ? patch.operandId
        : modifier.operandAssetId;
      const operandRecord = requestedOperandId
        && requestedOperandId !== activeAssetId
        ? workspace.session.state.geometry.records[requestedOperandId]
        : null;
      const operand = operandRecord
        ? studioEditableMeshToTriangleSoup(operandRecord.mesh)
        : modifier.operand;
      return {
        ...modifier,
        enabled,
        operation: patch.operation === "union"
          || patch.operation === "difference"
          || patch.operation === "intersection"
          ? patch.operation
          : modifier.operation,
        operandAssetId: operandRecord?.assetId ?? modifier.operandAssetId,
        operand: operandRecord
          ? {
              positions: new Float32Array(operand.positions),
              indices: new Uint32Array(operand.indices),
            }
          : modifier.operand,
      };
    }
    case "solidify":
      return {
        ...modifier,
        enabled,
        thickness: finiteNumber(patch.thickness, modifier.thickness, -10, 10),
        evenThickness: booleanValue(patch.evenThickness, modifier.evenThickness),
        rim: booleanValue(patch.rim, modifier.rim),
      };
    case "bevel":
      return {
        ...modifier,
        enabled,
        amount: finiteNumber(patch.amount, modifier.amount, 0, 0.45),
        segments: Math.trunc(finiteNumber(patch.segments, modifier.segments, 1, 1)),
        angleLimitRad: finiteNumber(
          patch.angleLimitRad,
          modifier.angleLimitRad,
          0,
          Math.PI,
        ),
        weightInfluence: finiteNumber(
          patch.weightInfluence,
          modifier.weightInfluence,
          0,
          1,
        ),
      };
    case "subdivision":
      return {
        ...modifier,
        enabled,
        levels: Math.trunc(finiteNumber(patch.levels, modifier.levels, 1, 3)),
        smooth: booleanValue(patch.smooth, modifier.smooth),
      };
    case "weld":
      return {
        ...modifier,
        enabled,
        quantum: finiteNumber(patch.quantum, modifier.quantum, 1e-6, 1_000_000),
      };
    case "decimate":
      return {
        ...modifier,
        enabled,
        ratio: finiteNumber(patch.ratio, modifier.ratio, 0.05, 0.95),
      };
    case "simple-deform":
      return {
        ...modifier,
        enabled,
        mode: patch.mode === "twist" || patch.mode === "taper" || patch.mode === "stretch"
          ? patch.mode
          : modifier.mode,
        axis: patch.axis === "x" || patch.axis === "y" || patch.axis === "z"
          ? patch.axis
          : modifier.axis,
        angleRad: finiteNumber(
          patch.angleRad,
          modifier.angleRad,
          -Math.PI * 8,
          Math.PI * 8,
        ),
        factor: finiteNumber(patch.factor, modifier.factor, 0.001, 100),
      };
  }
}

async function commitPreviewStack(
  workspace: StudioHybridDccWorkspace,
  modifiers: readonly StudioMeshModifier[],
): Promise<StudioHybridDccWorkspace> {
  const record = activeRecord(workspace);
  const resolved = await resolveBooleanOperands(workspace, record, modifiers);
  const stack = createStudioMeshModifierStack(record.mesh, resolved.modifiers);
  const evaluated = await evaluateStudioMeshModifierStack(stack, {
    booleanBackend: createStudioDefaultSolidBooleanBackend(),
  });
  if (!evaluated.ok) throw new Error(evaluated.detail);

  const committed = hybridDccSetModifierStack(
    workspace.session,
    record.assetId,
    stack,
  );
  const materialized = await materializeStudioGeometryRenderCache(
    committed.state.geometry,
    record.assetId,
    { booleanBackend: createStudioDefaultSolidBooleanBackend() },
  );
  if (!materialized.ok) throw new Error(materialized.detail);
  const session: StudioHybridDccSession = {
    ...committed,
    state: {
      ...committed.state,
      geometry: materialized.value.registry,
    },
  };
  const bridge = mutateStudioSharedObjectGeometry(
    workspace.bridge,
    record.assetId,
    materialized.value.cache.derivedFromHash,
  );
  return { ...workspace, session, bridge };
}

export async function workspaceAddActiveModifier(
  workspace: StudioHybridDccWorkspace,
  kind: StudioMeshModifierKind,
): Promise<StudioHybridDccWorkspace> {
  const record = activeRecord(workspace);
  return commitPreviewStack(workspace, [
    ...record.modifierStack.modifiers,
    defaultModifier(workspace, record, kind),
  ]);
}

export async function workspacePatchActiveModifier(
  workspace: StudioHybridDccWorkspace,
  modifierId: string,
  patch: StudioHybridDccModifierPatch,
): Promise<StudioHybridDccWorkspace> {
  const record = activeRecord(workspace);
  const index = record.modifierStack.modifiers.findIndex(({ id }) => id === modifierId);
  if (index < 0) throw new Error("선택한 변형 기록을 찾지 못했습니다.");
  const modifiers = record.modifierStack.modifiers.map((modifier, itemIndex) => (
    itemIndex === index
      ? patchModifier(workspace, record.assetId, modifier, patch)
      : modifier
  ));
  return commitPreviewStack(workspace, modifiers);
}

export function workspaceToggleActiveModifier(
  workspace: StudioHybridDccWorkspace,
  modifierId: string,
): Promise<StudioHybridDccWorkspace> {
  const record = activeRecord(workspace);
  const modifier = record.modifierStack.modifiers.find(({ id }) => id === modifierId);
  if (!modifier) throw new Error("선택한 변형 기록을 찾지 못했습니다.");
  return workspacePatchActiveModifier(workspace, modifierId, { enabled: !modifier.enabled });
}

export async function workspaceMoveActiveModifier(
  workspace: StudioHybridDccWorkspace,
  modifierId: string,
  direction: StudioHybridDccModifierMoveDirection,
): Promise<StudioHybridDccWorkspace> {
  const record = activeRecord(workspace);
  const modifiers = [...record.modifierStack.modifiers];
  const currentIndex = modifiers.findIndex(({ id }) => id === modifierId);
  if (currentIndex < 0) throw new Error("선택한 변형 기록을 찾지 못했습니다.");
  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= modifiers.length) return workspace;
  const current = modifiers[currentIndex]!;
  modifiers[currentIndex] = modifiers[nextIndex]!;
  modifiers[nextIndex] = current;
  return commitPreviewStack(workspace, modifiers);
}

export async function workspaceRemoveActiveModifier(
  workspace: StudioHybridDccWorkspace,
  modifierId: string,
): Promise<StudioHybridDccWorkspace> {
  const record = activeRecord(workspace);
  if (!record.modifierStack.modifiers.some(({ id }) => id === modifierId)) {
    throw new Error("선택한 변형 기록을 찾지 못했습니다.");
  }
  return commitPreviewStack(
    workspace,
    record.modifierStack.modifiers.filter(({ id }) => id !== modifierId),
  );
}

export async function workspaceApplyActiveModifierStack(
  workspace: StudioHybridDccWorkspace,
): Promise<StudioHybridDccWorkspace> {
  const record = activeRecord(workspace);
  if (record.modifierStack.modifiers.length === 0) return workspace;
  const expectedStackHash = hashStudioMeshModifierStack(record.modifierStack);
  const resolved = await resolveBooleanOperands(
    workspace,
    record,
    record.modifierStack.modifiers,
  );
  const resolvedStack = createStudioMeshModifierStack(record.mesh, resolved.modifiers);
  const evaluated = await evaluateStudioMeshModifierStack(resolvedStack, {
    booleanBackend: createStudioDefaultSolidBooleanBackend(),
  });
  if (!evaluated.ok) throw new Error(evaluated.detail);
  const session = hybridDccApplyModifierStack(
    workspace.session,
    record.assetId,
    {
      mesh: evaluated.value.mesh,
      sourceHash: evaluated.value.sourceHash,
      stackHash: expectedStackHash,
      resultHash: evaluated.value.resultHash,
      booleanOperands: resolved.receipts,
    },
  );
  const bridge = mutateStudioSharedObjectGeometry(
    workspace.bridge,
    record.assetId,
    evaluated.value.resultHash,
  );
  return { ...workspace, session, bridge };
}

/** Rebuilds disposable previews after undo/redo or a cold OPFS restore. */
export async function workspaceRefreshModifierPreviews(
  workspace: StudioHybridDccWorkspace,
): Promise<StudioHybridDccWorkspace> {
  let geometry = workspace.session.state.geometry;
  let bridge = workspace.bridge;
  let changed = false;
  const backend = createStudioDefaultSolidBooleanBackend();
  const records = Object.values(geometry.records)
    .toSorted((left, right) => left.assetId < right.assetId ? -1 : 1);
  for (const record of records) {
    if (record.modifierStack.modifiers.length === 0 || record.renderCache) continue;
    const materialized = await materializeStudioGeometryRenderCache(
      geometry,
      record.assetId,
      { booleanBackend: backend },
    );
    if (!materialized.ok) {
      throw new Error(`${record.assetId} 미리보기 복구 실패 · ${materialized.detail}`);
    }
    geometry = materialized.value.registry;
    bridge = mutateStudioSharedObjectGeometry(
      bridge,
      record.assetId,
      materialized.value.cache.derivedFromHash,
    );
    changed = true;
  }
  if (!changed) return workspace;
  return {
    ...workspace,
    bridge,
    session: {
      ...workspace.session,
      state: { ...workspace.session.state, geometry },
    },
  };
}

export function workspaceUndoWithModifierPreviews(
  workspace: StudioHybridDccWorkspace,
): Promise<StudioHybridDccWorkspace> {
  return workspaceRefreshModifierPreviews(workspaceUndo(workspace));
}

export function workspaceRedoWithModifierPreviews(
  workspace: StudioHybridDccWorkspace,
): Promise<StudioHybridDccWorkspace> {
  return workspaceRefreshModifierPreviews(workspaceRedo(workspace));
}
