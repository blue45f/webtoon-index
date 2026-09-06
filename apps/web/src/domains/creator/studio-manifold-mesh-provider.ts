import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_MANIFOLD_MESH_PROVIDER_REVISION = 1 as const;

export const STUDIO_MANIFOLD_MESH_BUDGETS = Object.freeze({
  maxInputVertices: 250_000,
  maxInputTriangles: 500_000,
  maxOutputVertices: 500_000,
  maxOutputTriangles: 1_000_000,
  maxOutputBytes: 128 * 1024 * 1024,
  maxWorkUnits: 2_000_000_000,
  maxCoordinateMagnitude: 1_000_000_000,
  maxConcurrentOperations: 1,
} as const);

export type StudioManifoldBooleanOperation =
  | "union"
  | "difference"
  | "intersection";

export interface StudioManifoldTriangleMeshInput {
  readonly positions: ArrayBufferView | readonly number[];
  readonly triangleIndices: ArrayBufferView | readonly number[];
}

export interface StudioManifoldPlainMesh {
  readonly positions: Float32Array;
  readonly triangleIndices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

export interface StudioManifoldTopology {
  readonly status: "NoError";
  readonly empty: boolean;
  readonly physicalVertexCount: number;
  readonly triangleCount: number;
  readonly genus: number;
  readonly surfaceArea: number;
  readonly volume: number;
  readonly boundingBox: Readonly<{
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  }> | null;
}

export interface StudioManifoldRuntimeMesh {
  readonly numProp: number;
  readonly vertProperties: Float32Array;
  readonly triangleIndices: Uint32Array;
}

export interface StudioManifoldRuntime {
  readonly version: string;
  createManifold(mesh: Readonly<{
    positions: Float32Array;
    triangleIndices: Uint32Array;
  }>): unknown;
  status(manifold: unknown): string;
  boolean(
    left: unknown,
    right: unknown,
    operation: StudioManifoldBooleanOperation,
  ): unknown;
  getMesh(manifold: unknown): StudioManifoldRuntimeMesh;
  inspectManifold(manifold: unknown): StudioManifoldTopology;
  deleteManifold(manifold: unknown): void;
  destroy(): Promise<void> | void;
}

export type StudioManifoldRuntimeLoader =
  () => Promise<StudioManifoldRuntime> | StudioManifoldRuntime;

export interface StudioManifoldMeshReceipt {
  readonly kind: "studio-manifold-mesh-receipt";
  readonly revision: typeof STUDIO_MANIFOLD_MESH_PROVIDER_REVISION;
  readonly providerId: "manifold-3d";
  readonly runtimeVersion: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly operation: StudioManifoldBooleanOperation;
  readonly workUnits: number;
  readonly inputs: {
    readonly left: {
      readonly vertexCount: number;
      readonly triangleCount: number;
      readonly hash: `sha256:${string}`;
    };
    readonly right: {
      readonly vertexCount: number;
      readonly triangleCount: number;
      readonly hash: `sha256:${string}`;
    };
  };
  readonly output: {
    readonly mesh: StudioManifoldPlainMesh;
    readonly topology: StudioManifoldTopology;
    readonly hash: `sha256:${string}`;
  };
  readonly receiptHash: `sha256:${string}`;
}

export class StudioManifoldMeshProviderError extends Error {
  constructor(
    readonly code:
      | "invalid-request"
      | "invalid-input-mesh"
      | "budget-exceeded"
      | "epoch-mismatch"
      | "backpressure"
      | "aborted"
      | "runtime-failed"
      | "invalid-runtime-output"
      | "disposed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioManifoldMeshProviderError";
  }
}

export interface StudioManifoldMeshProvider {
  boolean(input: Readonly<{
    left: StudioManifoldTriangleMeshInput;
    right: StudioManifoldTriangleMeshInput;
    operation: StudioManifoldBooleanOperation;
    epoch: number;
    signal?: AbortSignal;
  }>): Promise<StudioManifoldMeshReceipt>;
  snapshot(): Readonly<{
    state: "ready" | "destroying" | "destroyed";
    runtimeLoaded: boolean;
    epoch: number;
    sequence: number;
    activeOperations: number;
  }>;
  destroy(): Promise<void>;
}

interface PreparedMesh {
  readonly positions: Float32Array;
  readonly triangleIndices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly hash: `sha256:${string}`;
}

function invalid(message: string): never {
  throw new StudioManifoldMeshProviderError("invalid-request", message);
}

function invalidMesh(message: string): never {
  throw new StudioManifoldMeshProviderError("invalid-input-mesh", message);
}

function budget(message: string): never {
  throw new StudioManifoldMeshProviderError("budget-exceeded", message);
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new StudioManifoldMeshProviderError(
      "aborted",
      "Manifold mesh operation was aborted.",
    );
  }
}

function hashBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function numericValues(
  value: ArrayBufferView | readonly number[],
  label: string,
): readonly number[] {
  if (Array.isArray(value)) return [...value];
  if (
    !ArrayBuffer.isView(value)
    || !("length" in value)
    || typeof value.length !== "number"
  ) {
    invalid(`${label} must be a numeric array or typed array.`);
  }
  return Array.from(value as unknown as ArrayLike<number>);
}

function meshHash(
  positions: Float32Array,
  triangleIndices: Uint32Array,
): `sha256:${string}` {
  const bytes = new Uint8Array(
    8 + positions.byteLength + triangleIndices.byteLength,
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, positions.length, true);
  view.setUint32(4, triangleIndices.length, true);
  bytes.set(
    new Uint8Array(
      positions.buffer,
      positions.byteOffset,
      positions.byteLength,
    ),
    8,
  );
  bytes.set(
    new Uint8Array(
      triangleIndices.buffer,
      triangleIndices.byteOffset,
      triangleIndices.byteLength,
    ),
    8 + positions.byteLength,
  );
  return hashBytes(bytes);
}

function prepareMesh(
  input: StudioManifoldTriangleMeshInput,
  label: string,
): PreparedMesh {
  if (!input || typeof input !== "object") invalid(`${label} mesh is required.`);
  const positionValues = numericValues(input.positions, `${label}.positions`);
  const indexValues = numericValues(
    input.triangleIndices,
    `${label}.triangleIndices`,
  );
  if (positionValues.length < 12 || positionValues.length % 3 !== 0) {
    invalidMesh(`${label}.positions must contain at least four vec3 vertices.`);
  }
  if (indexValues.length < 12 || indexValues.length % 3 !== 0) {
    invalidMesh(
      `${label}.triangleIndices must contain at least four triangles.`,
    );
  }
  const vertexCount = positionValues.length / 3;
  const triangleCount = indexValues.length / 3;
  if (
    vertexCount > STUDIO_MANIFOLD_MESH_BUDGETS.maxInputVertices
    || triangleCount > STUDIO_MANIFOLD_MESH_BUDGETS.maxInputTriangles
  ) {
    budget(`${label} mesh exceeds input topology budgets.`);
  }
  const positions = new Float32Array(positionValues.length);
  for (let index = 0; index < positionValues.length; index += 1) {
    const component = positionValues[index]!;
    if (
      !Number.isFinite(component)
      || Math.abs(component)
        > STUDIO_MANIFOLD_MESH_BUDGETS.maxCoordinateMagnitude
    ) {
      invalidMesh(`${label}.positions contains an invalid coordinate.`);
    }
    positions[index] = component;
    if (!Number.isFinite(positions[index])) {
      invalidMesh(`${label}.positions cannot be represented as float32.`);
    }
  }
  const triangleIndices = new Uint32Array(indexValues.length);
  for (let index = 0; index < indexValues.length; index += 3) {
    const a = indexValues[index]!;
    const b = indexValues[index + 1]!;
    const c = indexValues[index + 2]!;
    if (
      !Number.isSafeInteger(a)
      || !Number.isSafeInteger(b)
      || !Number.isSafeInteger(c)
      || a < 0
      || b < 0
      || c < 0
      || a >= vertexCount
      || b >= vertexCount
      || c >= vertexCount
    ) {
      invalidMesh(`${label}.triangleIndices contains an invalid vertex index.`);
    }
    if (a === b || b === c || a === c) {
      invalidMesh(`${label}.triangleIndices contains a degenerate triangle.`);
    }
    const ax = positions[a * 3]!;
    const ay = positions[a * 3 + 1]!;
    const az = positions[a * 3 + 2]!;
    const abx = positions[b * 3]! - ax;
    const aby = positions[b * 3 + 1]! - ay;
    const abz = positions[b * 3 + 2]! - az;
    const acx = positions[c * 3]! - ax;
    const acy = positions[c * 3 + 1]! - ay;
    const acz = positions[c * 3 + 2]! - az;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    if (crossX ** 2 + crossY ** 2 + crossZ ** 2 <= 1e-20) {
      invalidMesh(`${label}.triangleIndices contains a zero-area triangle.`);
    }
    triangleIndices[index] = a;
    triangleIndices[index + 1] = b;
    triangleIndices[index + 2] = c;
  }
  return {
    positions,
    triangleIndices,
    vertexCount,
    triangleCount,
    hash: meshHash(positions, triangleIndices),
  };
}

function validateStatus(runtime: StudioManifoldRuntime, handle: unknown): void {
  const status = runtime.status(handle);
  if (status !== "NoError") {
    throw new StudioManifoldMeshProviderError(
      "invalid-input-mesh",
      `Manifold rejected a mesh or boolean result with status ${status}.`,
    );
  }
}

function finiteVec3(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some(
      (component) =>
        !Number.isFinite(component)
        || Math.abs(component)
          > STUDIO_MANIFOLD_MESH_BUDGETS.maxCoordinateMagnitude,
    )
  ) {
    throw new StudioManifoldMeshProviderError(
      "invalid-runtime-output",
      "Manifold returned an invalid bounding box.",
    );
  }
  return [value[0], value[1], value[2]];
}

function validateTopology(value: StudioManifoldTopology): StudioManifoldTopology {
  if (
    !value
    || value.status !== "NoError"
    || typeof value.empty !== "boolean"
    || !Number.isSafeInteger(value.physicalVertexCount)
    || value.physicalVertexCount < 0
    || !Number.isSafeInteger(value.triangleCount)
    || value.triangleCount < 0
    || !Number.isSafeInteger(value.genus)
    || !Number.isFinite(value.surfaceArea)
    || value.surfaceArea < 0
    || !Number.isFinite(value.volume)
    || value.volume < 0
    || (value.empty && value.boundingBox !== null)
    || (!value.empty && value.boundingBox === null)
  ) {
    throw new StudioManifoldMeshProviderError(
      "invalid-runtime-output",
      "Manifold returned invalid topology metadata.",
    );
  }
  const boundingBox = value.boundingBox
    ? {
        min: finiteVec3(value.boundingBox.min),
        max: finiteVec3(value.boundingBox.max),
      }
    : null;
  if (
    boundingBox
    && boundingBox.min.some(
      (component, index) => component > boundingBox.max[index]!,
    )
  ) {
    throw new StudioManifoldMeshProviderError(
      "invalid-runtime-output",
      "Manifold returned an inverted bounding box.",
    );
  }
  return {
    status: "NoError",
    empty: value.empty,
    physicalVertexCount: value.physicalVertexCount,
    triangleCount: value.triangleCount,
    genus: value.genus,
    surfaceArea: value.surfaceArea,
    volume: value.volume,
    boundingBox,
  };
}

function plainOutput(
  runtimeMesh: StudioManifoldRuntimeMesh,
): StudioManifoldPlainMesh {
  if (
    !runtimeMesh
    || !Number.isSafeInteger(runtimeMesh.numProp)
    || runtimeMesh.numProp < 3
    || !(runtimeMesh.vertProperties instanceof Float32Array)
    || runtimeMesh.vertProperties.length % runtimeMesh.numProp !== 0
    || !(runtimeMesh.triangleIndices instanceof Uint32Array)
    || runtimeMesh.triangleIndices.length % 3 !== 0
  ) {
    throw new StudioManifoldMeshProviderError(
      "invalid-runtime-output",
      "Manifold returned an invalid mesh.",
    );
  }
  const vertexCount = runtimeMesh.vertProperties.length / runtimeMesh.numProp;
  const triangleCount = runtimeMesh.triangleIndices.length / 3;
  const outputBytes = vertexCount * 3 * 4
    + runtimeMesh.triangleIndices.byteLength;
  if (
    vertexCount > STUDIO_MANIFOLD_MESH_BUDGETS.maxOutputVertices
    || triangleCount > STUDIO_MANIFOLD_MESH_BUDGETS.maxOutputTriangles
    || outputBytes > STUDIO_MANIFOLD_MESH_BUDGETS.maxOutputBytes
  ) {
    budget("Manifold result exceeds output mesh budgets.");
  }
  const positions = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let component = 0; component < 3; component += 1) {
      const value = runtimeMesh.vertProperties[
        vertex * runtimeMesh.numProp + component
      ]!;
      if (
        !Number.isFinite(value)
        || Math.abs(value)
          > STUDIO_MANIFOLD_MESH_BUDGETS.maxCoordinateMagnitude
      ) {
        throw new StudioManifoldMeshProviderError(
          "invalid-runtime-output",
          "Manifold returned a non-finite output vertex.",
        );
      }
      positions[vertex * 3 + component] = value;
    }
  }
  const triangleIndices = new Uint32Array(runtimeMesh.triangleIndices);
  if (
    triangleIndices.some((index) => index >= vertexCount)
  ) {
    throw new StudioManifoldMeshProviderError(
      "invalid-runtime-output",
      "Manifold returned an out-of-range triangle index.",
    );
  }
  return { positions, triangleIndices, vertexCount, triangleCount };
}

function asProviderError(error: unknown): StudioManifoldMeshProviderError {
  if (error instanceof StudioManifoldMeshProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new StudioManifoldMeshProviderError(
      "aborted",
      "Manifold mesh operation was aborted.",
      { cause: error },
    );
  }
  return new StudioManifoldMeshProviderError(
    "runtime-failed",
    "Manifold mesh runtime failed.",
    { cause: error },
  );
}

export function createStudioManifoldMeshProvider(
  options: Readonly<{
    epoch?: number;
    runtimeLoader?: StudioManifoldRuntimeLoader;
  }> = {},
): StudioManifoldMeshProvider {
  const epoch = options.epoch ?? 0;
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    invalid("epoch must be a non-negative safe integer.");
  }
  const runtimeLoader = options.runtimeLoader ?? loadStudioManifoldRuntime;
  let state: "ready" | "destroying" | "destroyed" = "ready";
  let runtimePromise: Promise<StudioManifoldRuntime> | null = null;
  let runtime: StudioManifoldRuntime | null = null;
  let sequence = 0;
  let activeOperations = 0;
  let resolveIdle: (() => void) | null = null;
  let destroyPromise: Promise<void> | null = null;

  const loadRuntime = (): Promise<StudioManifoldRuntime> => {
    if (runtime) return Promise.resolve(runtime);
    if (!runtimePromise) {
      runtimePromise = Promise.resolve()
        .then(runtimeLoader)
        .then((loaded) => {
          runtime = loaded;
          return loaded;
        })
        .catch((error: unknown) => {
          runtimePromise = null;
          throw error;
        });
    }
    return runtimePromise;
  };

  const enter = (signal?: AbortSignal): number => {
    if (state !== "ready") {
      throw new StudioManifoldMeshProviderError(
        "disposed",
        "Manifold mesh provider is not ready.",
      );
    }
    aborted(signal);
    if (
      activeOperations
      >= STUDIO_MANIFOLD_MESH_BUDGETS.maxConcurrentOperations
    ) {
      throw new StudioManifoldMeshProviderError(
        "backpressure",
        "Manifold mesh operation budget exceeded.",
      );
    }
    activeOperations += 1;
    sequence += 1;
    return sequence;
  };

  const leave = (): void => {
    activeOperations -= 1;
    if (activeOperations === 0) {
      resolveIdle?.();
      resolveIdle = null;
    }
  };

  const provider: StudioManifoldMeshProvider = {
    boolean(input) {
      let left: PreparedMesh;
      let right: PreparedMesh;
      let admittedSequence: number;
      try {
        if (!input || typeof input !== "object") {
          invalid("A Manifold boolean request is required.");
        }
        if (
          input.operation !== "union"
          && input.operation !== "difference"
          && input.operation !== "intersection"
        ) {
          invalid("Unsupported Manifold boolean operation.");
        }
        if (!Number.isSafeInteger(input.epoch) || input.epoch !== epoch) {
          throw new StudioManifoldMeshProviderError(
            "epoch-mismatch",
            "Manifold mesh request epoch does not match.",
          );
        }
        left = prepareMesh(input.left, "left");
        right = prepareMesh(input.right, "right");
        const workUnits = left.triangleCount * right.triangleCount;
        if (workUnits > STUDIO_MANIFOLD_MESH_BUDGETS.maxWorkUnits) {
          budget("Manifold boolean exceeds the bounded work estimate.");
        }
        admittedSequence = enter(input.signal);
      } catch (error) {
        return Promise.reject(error);
      }

      return (async () => {
        const handles: unknown[] = [];
        try {
          const loaded = await loadRuntime();
          aborted(input.signal);
          const leftHandle = loaded.createManifold({
            positions: left.positions,
            triangleIndices: left.triangleIndices,
          });
          if (!leftHandle) {
            throw new StudioManifoldMeshProviderError(
              "invalid-runtime-output",
              "Manifold returned an empty left handle.",
            );
          }
          handles.push(leftHandle);
          validateStatus(loaded, leftHandle);
          aborted(input.signal);
          const rightHandle = loaded.createManifold({
            positions: right.positions,
            triangleIndices: right.triangleIndices,
          });
          if (!rightHandle) {
            throw new StudioManifoldMeshProviderError(
              "invalid-runtime-output",
              "Manifold returned an empty right handle.",
            );
          }
          handles.push(rightHandle);
          validateStatus(loaded, rightHandle);
          aborted(input.signal);
          const resultHandle = loaded.boolean(
            leftHandle,
            rightHandle,
            input.operation,
          );
          if (!resultHandle) {
            throw new StudioManifoldMeshProviderError(
              "invalid-runtime-output",
              "Manifold returned an empty boolean result handle.",
            );
          }
          handles.push(resultHandle);
          validateStatus(loaded, resultHandle);
          aborted(input.signal);
          const mesh = plainOutput(loaded.getMesh(resultHandle));
          const topology = validateTopology(
            loaded.inspectManifold(resultHandle),
          );
          if (
            topology.triangleCount !== mesh.triangleCount
          ) {
            throw new StudioManifoldMeshProviderError(
              "invalid-runtime-output",
              "Manifold mesh and topology counts do not match.",
            );
          }
          const workUnits = left.triangleCount * right.triangleCount;
          const outputHash = meshHash(mesh.positions, mesh.triangleIndices);
          const receiptWithoutHash = {
            kind: "studio-manifold-mesh-receipt" as const,
            revision: STUDIO_MANIFOLD_MESH_PROVIDER_REVISION,
            providerId: "manifold-3d" as const,
            runtimeVersion: loaded.version,
            epoch,
            sequence: admittedSequence,
            operation: input.operation,
            workUnits,
            inputs: {
              left: {
                vertexCount: left.vertexCount,
                triangleCount: left.triangleCount,
                hash: left.hash,
              },
              right: {
                vertexCount: right.vertexCount,
                triangleCount: right.triangleCount,
                hash: right.hash,
              },
            },
            output: {
              vertexCount: mesh.vertexCount,
              triangleCount: mesh.triangleCount,
              topology,
              hash: outputHash,
            },
          };
          return {
            ...receiptWithoutHash,
            output: { mesh, topology, hash: outputHash },
            receiptHash: hashBytes(
              new TextEncoder().encode(JSON.stringify(receiptWithoutHash)),
            ),
          };
        } catch (error) {
          throw asProviderError(error);
        } finally {
          const deleted = new Set<unknown>();
          for (let index = handles.length - 1; index >= 0; index -= 1) {
            const handle = handles[index]!;
            if (deleted.has(handle)) continue;
            deleted.add(handle);
            try {
              runtime?.deleteManifold(handle);
            } catch {
              // The original result/error wins; all handles are dropped below.
            }
          }
          leave();
        }
      })();
    },

    snapshot() {
      return {
        state,
        runtimeLoaded: runtime !== null,
        epoch,
        sequence,
        activeOperations,
      };
    },

    destroy() {
      if (destroyPromise) return destroyPromise;
      state = "destroying";
      destroyPromise = (async () => {
        if (activeOperations > 0) {
          await new Promise<void>((resolve) => {
            resolveIdle = resolve;
          });
        }
        if (runtime) await runtime.destroy();
        runtime = null;
        runtimePromise = null;
        state = "destroyed";
      })();
      return destroyPromise;
    },
  };
  return provider;
}

type ManifoldModule = import("manifold-3d").ManifoldToplevel;
type ManifoldHandle = import("manifold-3d").Manifold;

export function createStudioManifoldRuntime(
  module: ManifoldModule,
): StudioManifoldRuntime {
  return {
    version: "manifold-3d-3.5.1",
    createManifold(mesh) {
      const source = new module.Mesh({
        numProp: 3,
        vertProperties: new Float32Array(mesh.positions),
        triVerts: new Uint32Array(mesh.triangleIndices),
      });
      return new module.Manifold(source);
    },
    status(manifold) {
      return (manifold as ManifoldHandle).status();
    },
    boolean(leftValue, rightValue, operation) {
      const left = leftValue as ManifoldHandle;
      const right = rightValue as ManifoldHandle;
      switch (operation) {
        case "union":
          return left.add(right);
        case "difference":
          return left.subtract(right);
        case "intersection":
          return left.intersect(right);
      }
    },
    getMesh(manifold) {
      const mesh = (manifold as ManifoldHandle).getMesh();
      return {
        numProp: mesh.numProp,
        vertProperties: new Float32Array(mesh.vertProperties),
        triangleIndices: new Uint32Array(mesh.triVerts),
      };
    },
    inspectManifold(manifoldValue) {
      const manifold = manifoldValue as ManifoldHandle;
      const empty = manifold.isEmpty();
      const bounds = empty ? null : manifold.boundingBox();
      return {
        status: "NoError",
        empty,
        physicalVertexCount: manifold.numVert(),
        triangleCount: manifold.numTri(),
        genus: manifold.genus(),
        surfaceArea: manifold.surfaceArea(),
        volume: manifold.volume(),
        boundingBox: bounds
          ? {
              min: [bounds.min[0], bounds.min[1], bounds.min[2]],
              max: [bounds.max[0], bounds.max[1], bounds.max[2]],
            }
          : null,
      };
    },
    deleteManifold(manifold) {
      (manifold as ManifoldHandle).delete();
    },
    destroy() {
      // Every Manifold handle is explicitly deleted in reverse creation order.
    },
  };
}

/** Loads the Manifold WASM module only when the first boolean is admitted. */
export async function loadStudioManifoldRuntime():
Promise<StudioManifoldRuntime> {
  const [factory, wasmAsset] = await Promise.all([
    import("manifold-3d"),
    import("manifold-3d/manifold.wasm?url"),
  ]);
  const module = await factory.default({
    locateFile: () => wasmAsset.default,
  });
  module.setup();
  return createStudioManifoldRuntime(module);
}
