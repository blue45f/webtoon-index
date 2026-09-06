/**
 * Geometry Authority registry — one editable authority per asset; BufferGeometry is derived cache only.
 */

import {
  createStudioUnitCubeMesh,
  hashStudioEditableMesh,
  STUDIO_EDITABLE_MESH_LIMITS,
  studioEditableMeshToTriangleSoup,
  validateStudioEditableMeshSerializableAuthority,
  type StudioEditableMesh,
} from "./studio-editable-half-edge-mesh";
import {
  createStudioMeshModifierStack,
  deserializeStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  hashStudioMeshModifierStack,
  serializeStudioMeshModifierStack,
  type StudioMeshModifierStack,
  type StudioSolidBooleanBackend,
} from "./studio-mesh-modifier-stack";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_GEOMETRY_AUTHORITY_REVISION = 1 as const;
/** Shared source/render coordinate budget. Values outside this range are never renderer-safe. */
export const STUDIO_GEOMETRY_MAX_ABSOLUTE_COORDINATE = 1_000_000 as const;

export type StudioGeometryKernelKind =
  | "half-edge"
  | "manifold-solid"
  | "render-cache";

export interface StudioRenderMeshCache {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Binds this disposable projection to the immutable authority source it was evaluated from. */
  readonly sourceMeshHash: string;
  /** Binds order, parameters, enabled state, and Boolean operands of the evaluated stack. */
  readonly sourceModifierStackHash: string;
  /** Content address of the exact positions/indices payload, independent of the result mesh hash. */
  readonly contentHash: `sha256:${string}`;
  readonly derivedFromHash: string;
  readonly generatedAt: number;
}

export interface StudioGeometryAuthorityRecord {
  readonly assetId: string;
  readonly kernel: StudioGeometryKernelKind;
  readonly mesh: StudioEditableMesh;
  readonly modifierStack: StudioMeshModifierStack;
  readonly renderCache: StudioRenderMeshCache | null;
  readonly meshHash: string;
  readonly revision: number;
}

export interface StudioGeometryAuthorityRegistry {
  readonly revision: typeof STUDIO_GEOMETRY_AUTHORITY_REVISION;
  readonly records: Readonly<Record<string, StudioGeometryAuthorityRecord>>;
}

export type StudioGeometryAuthorityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly detail: string };

export interface StudioGeometryAuthorityRegistrationOptions {
  readonly modifierStack?: StudioMeshModifierStack;
  /** Snapshot hydration only; ordinary registration starts at revision 1. */
  readonly recordRevision?: number;
}

function validateStudioGeometryAuthorityCoordinates(
  mesh: StudioEditableMesh,
): StudioGeometryAuthorityResult<StudioEditableMesh> {
  for (const vertex of mesh.vertices) {
    for (const coordinate of [vertex.position.x, vertex.position.y, vertex.position.z]) {
      if (!Number.isFinite(coordinate)) {
        return {
          ok: false,
          code: "non-finite-coordinate",
          detail: `vertex ${vertex.id} contains a non-finite coordinate`,
        };
      }
      if (Math.abs(coordinate) > STUDIO_GEOMETRY_MAX_ABSOLUTE_COORDINATE) {
        return {
          ok: false,
          code: "coordinate-out-of-range",
          detail: `vertex ${vertex.id} exceeds the coordinate budget`,
        };
      }

      // The renderer consumes Float32Array data. Validate the exact projected value too so
      // authority admission cannot succeed while its disposable render projection overflows.
      const projected = Math.fround(coordinate);
      if (!Number.isFinite(projected)
        || Math.abs(projected) > STUDIO_GEOMETRY_MAX_ABSOLUTE_COORDINATE) {
        return {
          ok: false,
          code: "coordinate-out-of-range",
          detail: `vertex ${vertex.id} is outside the Float32 coordinate budget`,
        };
      }
    }
  }
  return { ok: true, value: mesh };
}

function validateStudioGeometryAuthorityMesh(
  mesh: StudioEditableMesh,
): StudioGeometryAuthorityResult<StudioEditableMesh> {
  const serializable = validateStudioEditableMeshSerializableAuthority(mesh);
  if (!serializable.ok) {
    return { ok: false, code: serializable.code, detail: serializable.detail };
  }
  return validateStudioGeometryAuthorityCoordinates(mesh);
}

function validateStudioGeometryRenderPositions(
  positions: Float32Array,
): StudioGeometryAuthorityResult<Float32Array> {
  for (const coordinate of positions) {
    if (!Number.isFinite(coordinate)
      || Math.abs(coordinate) > STUDIO_GEOMETRY_MAX_ABSOLUTE_COORDINATE) {
      return {
        ok: false,
        code: "invalid-render-cache",
        detail: "Float32 render projection exceeds the coordinate budget",
      };
    }
  }
  return { ok: true, value: positions };
}

function normalizeAuthorityModifierStack(
  mesh: StudioEditableMesh,
  stack: StudioMeshModifierStack,
): StudioGeometryAuthorityResult<StudioMeshModifierStack> {
  if (hashStudioEditableMesh(stack.source) !== hashStudioEditableMesh(mesh)) {
    return {
      ok: false,
      code: "source-mismatch",
      detail: "modifier stack source must match the authority mesh",
    };
  }
  try {
    const decoded = deserializeStudioMeshModifierStack(
      serializeStudioMeshModifierStack(stack),
      mesh,
    );
    return decoded.ok
      ? decoded
      : { ok: false, code: decoded.code, detail: decoded.detail };
  } catch (error) {
    return {
      ok: false,
      code: "invalid-stack",
      detail: error instanceof Error ? error.message : "invalid modifier stack",
    };
  }
}

export function createStudioGeometryAuthorityRegistry(): StudioGeometryAuthorityRegistry {
  return {
    revision: STUDIO_GEOMETRY_AUTHORITY_REVISION,
    records: {},
  };
}

export function registerStudioGeometryAuthority(
  registry: StudioGeometryAuthorityRegistry,
  assetId: string,
  mesh: StudioEditableMesh = createStudioUnitCubeMesh(),
  options: StudioGeometryAuthorityRegistrationOptions = {},
): StudioGeometryAuthorityResult<StudioGeometryAuthorityRegistry> {
  if (!assetId || assetId.length > 160) {
    return { ok: false, code: "invalid-id", detail: "assetId required" };
  }
  if (registry.records[assetId]) {
    return { ok: false, code: "duplicate", detail: `asset ${assetId} exists` };
  }
  if (options.recordRevision !== undefined
    && (!Number.isSafeInteger(options.recordRevision) || options.recordRevision < 1)) {
    return { ok: false, code: "invalid-revision", detail: "record revision must be >= 1" };
  }
  const coordinates = validateStudioGeometryAuthorityMesh(mesh);
  if (!coordinates.ok) return coordinates;
  const normalized = options.modifierStack
    ? normalizeAuthorityModifierStack(mesh, options.modifierStack)
    : { ok: true as const, value: createStudioMeshModifierStack(mesh) };
  if (!normalized.ok) return normalized;
  const record: StudioGeometryAuthorityRecord = {
    assetId,
    kernel: "half-edge",
    mesh,
    modifierStack: normalized.value,
    renderCache: null,
    meshHash: hashStudioEditableMesh(mesh),
    revision: options.recordRevision ?? 1,
  };
  return {
    ok: true,
    value: {
      ...registry,
      records: { ...registry.records, [assetId]: record },
    },
  };
}

export function getStudioGeometryAuthority(
  registry: StudioGeometryAuthorityRegistry,
  assetId: string,
): StudioGeometryAuthorityRecord | null {
  return registry.records[assetId] ?? null;
}

/** Commit a new authority mesh; invalidates render cache. */
export function commitStudioGeometryAuthorityMesh(
  registry: StudioGeometryAuthorityRegistry,
  assetId: string,
  mesh: StudioEditableMesh,
): StudioGeometryAuthorityResult<StudioGeometryAuthorityRegistry> {
  const prev = registry.records[assetId];
  if (!prev) return { ok: false, code: "not-found", detail: assetId };
  const coordinates = validateStudioGeometryAuthorityMesh(mesh);
  if (!coordinates.ok) return coordinates;
  const stack = createStudioMeshModifierStack(mesh, prev.modifierStack.modifiers);
  const record: StudioGeometryAuthorityRecord = {
    ...prev,
    mesh,
    modifierStack: stack,
    renderCache: null,
    meshHash: hashStudioEditableMesh(mesh),
    revision: prev.revision + 1,
  };
  return {
    ok: true,
    value: {
      ...registry,
      records: { ...registry.records, [assetId]: record },
    },
  };
}

export function setStudioGeometryAuthorityModifierStack(
  registry: StudioGeometryAuthorityRegistry,
  assetId: string,
  stack: StudioMeshModifierStack,
): StudioGeometryAuthorityResult<StudioGeometryAuthorityRegistry> {
  const prev = registry.records[assetId];
  if (!prev) return { ok: false, code: "not-found", detail: assetId };
  const coordinates = validateStudioGeometryAuthorityMesh(prev.mesh);
  if (!coordinates.ok) return coordinates;
  const normalized = normalizeAuthorityModifierStack(prev.mesh, stack);
  if (!normalized.ok) return normalized;
  if (hashStudioMeshModifierStack(prev.modifierStack)
    === hashStudioMeshModifierStack(normalized.value)) {
    return { ok: true, value: registry };
  }
  const record: StudioGeometryAuthorityRecord = {
    ...prev,
    modifierStack: normalized.value,
    renderCache: null,
    revision: prev.revision + 1,
  };
  return {
    ok: true,
    value: {
      ...registry,
      records: { ...registry.records, [assetId]: record },
    },
  };
}

/**
 * Atomically promotes an already evaluated mesh to authority and clears the non-destructive stack.
 * The prior source and stack remain untouched for the document command snapshot/undo boundary.
 */
export function applyStudioGeometryAuthorityModifierStack(
  registry: StudioGeometryAuthorityRegistry,
  assetId: string,
  evaluatedMesh: StudioEditableMesh,
): StudioGeometryAuthorityResult<StudioGeometryAuthorityRegistry> {
  const prev = registry.records[assetId];
  if (!prev) return { ok: false, code: "not-found", detail: assetId };
  if (prev.modifierStack.modifiers.length === 0) {
    return { ok: false, code: "empty-stack", detail: `asset ${assetId} has no modifiers` };
  }
  if (hashStudioEditableMesh(prev.modifierStack.source) !== prev.meshHash) {
    return {
      ok: false,
      code: "source-mismatch",
      detail: "modifier stack source diverged from the authority mesh",
    };
  }
  const coordinates = validateStudioGeometryAuthorityMesh(evaluatedMesh);
  if (!coordinates.ok) return coordinates;
  const meshHash = hashStudioEditableMesh(evaluatedMesh);
  const record: StudioGeometryAuthorityRecord = {
    ...prev,
    mesh: evaluatedMesh,
    modifierStack: createStudioMeshModifierStack(evaluatedMesh),
    renderCache: null,
    meshHash,
    revision: prev.revision + 1,
  };
  return {
    ok: true,
    value: {
      ...registry,
      records: { ...registry.records, [assetId]: record },
    },
  };
}

/** Evaluate modifiers and materialize derived render cache (never authority). */
export async function materializeStudioGeometryRenderCache(
  registry: StudioGeometryAuthorityRegistry,
  assetId: string,
  options: { readonly booleanBackend?: StudioSolidBooleanBackend; readonly now?: number } = {},
): Promise<StudioGeometryAuthorityResult<{
  readonly registry: StudioGeometryAuthorityRegistry;
  readonly cache: StudioRenderMeshCache;
}>> {
  const prev = registry.records[assetId];
  if (!prev) return { ok: false, code: "not-found", detail: assetId };
  const sourceCoordinates = validateStudioGeometryAuthorityMesh(prev.mesh);
  if (!sourceCoordinates.ok) return sourceCoordinates;
  const evaluated = await evaluateStudioMeshModifierStack(prev.modifierStack, {
    booleanBackend: options.booleanBackend,
  });
  if (!evaluated.ok) {
    return { ok: false, code: evaluated.code, detail: evaluated.detail };
  }
  const evaluatedCoordinates = validateStudioGeometryAuthorityMesh(evaluated.value.mesh);
  if (!evaluatedCoordinates.ok) return evaluatedCoordinates;
  const soup = studioEditableMeshToTriangleSoup(evaluated.value.mesh);
  const projectedCoordinates = validateStudioGeometryRenderPositions(soup.positions);
  if (!projectedCoordinates.ok) return projectedCoordinates;
  const derivedFromHash = evaluated.value.resultHash;
  const cache: StudioRenderMeshCache = {
    positions: soup.positions,
    indices: soup.indices,
    sourceMeshHash: prev.meshHash,
    sourceModifierStackHash: hashStudioMeshModifierStack(prev.modifierStack),
    contentHash: contentAddressStudioGeometryBytes(soup.positions, soup.indices),
    derivedFromHash,
    generatedAt: options.now ?? 0,
  };
  const record: StudioGeometryAuthorityRecord = {
    ...prev,
    renderCache: cache,
  };
  if (!assertRenderCacheIsNotAuthority(record)) {
    return {
      ok: false,
      code: "invalid-render-cache",
      detail: "evaluated render cache failed authority/provenance validation",
    };
  }
  return {
    ok: true,
    value: {
      registry: {
        ...registry,
        records: { ...registry.records, [assetId]: record },
      },
      cache,
    },
  };
}

export function assertRenderCacheIsNotAuthority(
  record: StudioGeometryAuthorityRecord,
): boolean {
  if (!record.renderCache) return true;
  const cache = record.renderCache;
  if (record.kernel !== "half-edge") return false;

  let authorityHash: string;
  let modifierSourceHash: string;
  let modifierStackHash: string;
  try {
    authorityHash = hashStudioEditableMesh(record.mesh);
    modifierSourceHash = hashStudioEditableMesh(record.modifierStack.source);
    modifierStackHash = hashStudioMeshModifierStack(record.modifierStack);
  } catch {
    return false;
  }
  if (authorityHash !== record.meshHash
    || modifierSourceHash !== record.meshHash
    || cache.sourceMeshHash !== record.meshHash
    || cache.sourceModifierStackHash !== modifierStackHash
    || !/^sha256:[0-9a-f]{64}$/u.test(cache.contentHash)
    || !/^(?:mesh:[0-9a-f]{8}|mesh:sha256:[0-9a-f]{64})$/u.test(cache.derivedFromHash)
    || !Number.isFinite(cache.generatedAt)
    || cache.generatedAt < 0) {
    return false;
  }
  if (!(cache.positions instanceof Float32Array)
    || cache.positions.length === 0
    || cache.positions.length % 3 !== 0
    || !(cache.indices instanceof Uint32Array)
    || cache.indices.length === 0
    || cache.indices.length % 3 !== 0) {
    return false;
  }
  const vertexCount = cache.positions.length / 3;
  const triangleCount = cache.indices.length / 3;
  if (vertexCount > STUDIO_EDITABLE_MESH_LIMITS.maxVertices
    || triangleCount > STUDIO_EDITABLE_MESH_LIMITS.maxFaces) {
    return false;
  }
  for (const coordinate of cache.positions) {
    if (!Number.isFinite(coordinate)
      || Math.abs(coordinate) > STUDIO_GEOMETRY_MAX_ABSOLUTE_COORDINATE) {
      return false;
    }
  }
  for (let offset = 0; offset < cache.indices.length; offset += 3) {
    const a = cache.indices[offset]!;
    const b = cache.indices[offset + 1]!;
    const c = cache.indices[offset + 2]!;
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount
      || a === b || b === c || a === c) {
      return false;
    }
  }
  return cache.contentHash === contentAddressStudioGeometryBytes(
    cache.positions,
    cache.indices,
  );
}

export function contentAddressStudioGeometryBytes(
  positions: Float32Array,
  indices: Uint32Array,
): `sha256:${string}` {
  const bytes = new Uint8Array(positions.byteLength + indices.byteLength + 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, positions.length, true);
  view.setUint32(4, indices.length, true);
  bytes.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), 8);
  bytes.set(
    new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength),
    8 + positions.byteLength,
  );
  return `sha256:${sha256HexPortable(bytes)}`;
}
