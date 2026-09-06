import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_GLTF_TRANSFORM_PROVIDER_REVISION = 1 as const;

export const STUDIO_GLTF_TRANSFORM_BUDGETS = Object.freeze({
  maxInputBytes: 256 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
  maxOperations: 4,
  maxScenes: 10_000,
  maxNodes: 500_000,
  maxMeshes: 100_000,
  maxPrimitives: 500_000,
  maxMaterials: 100_000,
  maxTextures: 20_000,
  maxAnimations: 20_000,
  maxAccessors: 1_000_000,
  maxAccessorElements: 500_000_000,
  maxTextureBytes: 256 * 1024 * 1024,
  maxBuffers: 100_000,
  maxSkins: 100_000,
  maxCameras: 100_000,
  maxCoordinateMagnitude: 1_000_000_000,
  maxConcurrentOperations: 1,
} as const);

export interface StudioGltfTransformStats {
  readonly scenes: number;
  readonly nodes: number;
  readonly meshes: number;
  readonly primitives: number;
  readonly materials: number;
  readonly textures: number;
  readonly animations: number;
  readonly accessors: number;
  readonly accessorElements: number;
  readonly textureBytes: number;
  readonly buffers: number;
  readonly skins: number;
  readonly cameras: number;
}

export type StudioGltfTransformOperation =
  | Readonly<{
      kind: "dedup";
      keepUniqueNames?: boolean;
    }>
  | Readonly<{
      kind: "prune";
      keepLeaves?: boolean;
      keepAttributes?: boolean;
      keepSolidTextures?: boolean;
      keepExtras?: boolean;
    }>
  | Readonly<{
      kind: "flatten";
      cleanup?: boolean;
    }>
  | Readonly<{
      kind: "center";
      pivot?: "center" | "above" | "below" | readonly [number, number, number];
    }>;

export interface StudioGltfTransformRuntime {
  readonly version: string;
  readBinary(glb: Uint8Array): Promise<unknown>;
  inspectDocument(document: unknown): StudioGltfTransformStats;
  transform(
    document: unknown,
    operation: StudioGltfTransformOperation,
  ): Promise<void>;
  writeBinary(document: unknown): Promise<Uint8Array>;
  destroyDocument(document: unknown): void;
  destroy(): Promise<void> | void;
}

export type StudioGltfTransformRuntimeLoader =
  () => Promise<StudioGltfTransformRuntime> | StudioGltfTransformRuntime;

export interface StudioGltfTransformReceipt {
  readonly kind: "studio-gltf-transform-receipt";
  readonly revision: typeof STUDIO_GLTF_TRANSFORM_PROVIDER_REVISION;
  readonly providerId: "gltf-transform";
  readonly runtimeVersion: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly operations: readonly StudioGltfTransformOperation[];
  readonly input: {
    readonly byteLength: number;
    readonly hash: `sha256:${string}`;
  };
  readonly output: {
    readonly byteLength: number;
    readonly hash: `sha256:${string}`;
    readonly glb: Uint8Array;
  };
  readonly before: StudioGltfTransformStats;
  readonly after: StudioGltfTransformStats;
  readonly receiptHash: `sha256:${string}`;
}

export class StudioGltfTransformProviderError extends Error {
  constructor(
    readonly code:
      | "invalid-request"
      | "invalid-glb"
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
    this.name = "StudioGltfTransformProviderError";
  }
}

export interface StudioGltfTransformProvider {
  transform(input: Readonly<{
    glb: ArrayBuffer | ArrayBufferView;
    epoch: number;
    operations?: readonly StudioGltfTransformOperation[];
    signal?: AbortSignal;
  }>): Promise<StudioGltfTransformReceipt>;
  snapshot(): Readonly<{
    state: "ready" | "destroying" | "destroyed";
    runtimeLoaded: boolean;
    epoch: number;
    sequence: number;
    activeOperations: number;
  }>;
  destroy(): Promise<void>;
}

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

const STAT_BUDGETS: Readonly<
  Record<keyof StudioGltfTransformStats, number>
> = {
  scenes: STUDIO_GLTF_TRANSFORM_BUDGETS.maxScenes,
  nodes: STUDIO_GLTF_TRANSFORM_BUDGETS.maxNodes,
  meshes: STUDIO_GLTF_TRANSFORM_BUDGETS.maxMeshes,
  primitives: STUDIO_GLTF_TRANSFORM_BUDGETS.maxPrimitives,
  materials: STUDIO_GLTF_TRANSFORM_BUDGETS.maxMaterials,
  textures: STUDIO_GLTF_TRANSFORM_BUDGETS.maxTextures,
  animations: STUDIO_GLTF_TRANSFORM_BUDGETS.maxAnimations,
  accessors: STUDIO_GLTF_TRANSFORM_BUDGETS.maxAccessors,
  accessorElements: STUDIO_GLTF_TRANSFORM_BUDGETS.maxAccessorElements,
  textureBytes: STUDIO_GLTF_TRANSFORM_BUDGETS.maxTextureBytes,
  buffers: STUDIO_GLTF_TRANSFORM_BUDGETS.maxBuffers,
  skins: STUDIO_GLTF_TRANSFORM_BUDGETS.maxSkins,
  cameras: STUDIO_GLTF_TRANSFORM_BUDGETS.maxCameras,
};

function invalid(message: string): never {
  throw new StudioGltfTransformProviderError("invalid-request", message);
}

function invalidGlb(message: string): never {
  throw new StudioGltfTransformProviderError("invalid-glb", message);
}

function budget(message: string): never {
  throw new StudioGltfTransformProviderError("budget-exceeded", message);
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new StudioGltfTransformProviderError(
      "aborted",
      "glTF Transform operation was aborted.",
    );
  }
}

function hashBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function copyBytes(
  value: ArrayBuffer | ArrayBufferView,
  label: string,
  maxBytes: number,
): Uint8Array {
  const declaredByteLength = value instanceof ArrayBuffer
    ? value.byteLength
    : ArrayBuffer.isView(value)
      ? value.byteLength
      : -1;
  if (declaredByteLength < 0) {
    invalid(`${label} must be an ArrayBuffer or ArrayBufferView.`);
  }
  if (declaredByteLength > maxBytes) {
    budget(`${label} exceeds the GLB byte budget.`);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  return new Uint8Array(
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
  );
}

function requestDataProperty(
  input: object,
  key: "glb" | "epoch" | "operations" | "signal",
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor || !("value" in descriptor)) {
    invalid(`glTF Transform request.${key} must be an own data property.`);
  }
  return descriptor.value;
}

function validateGlb(bytes: Uint8Array, maxBytes: number, label: string): void {
  if (bytes.byteLength > maxBytes) {
    budget(`${label} exceeds the GLB byte budget.`);
  }
  if (bytes.byteLength < 20) invalidGlb(`${label} is too short for GLB 2.0.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    invalidGlb(`${label} does not have the GLB magic header.`);
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    invalidGlb(`${label} must use GLB version 2.`);
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    invalidGlb(`${label} declared length does not match its byte length.`);
  }

  let offset = 12;
  let chunkIndex = 0;
  let jsonChunks = 0;
  let binChunks = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      invalidGlb(`${label} contains a truncated chunk header.`);
    }
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    if (chunkLength % 4 !== 0 || offset + 8 + chunkLength > bytes.byteLength) {
      invalidGlb(`${label} contains an invalid chunk length.`);
    }
    if (chunkIndex === 0 && chunkType !== GLB_JSON_CHUNK) {
      invalidGlb(`${label} must begin with a JSON chunk.`);
    }
    if (chunkType === GLB_JSON_CHUNK) {
      jsonChunks += 1;
      if (jsonChunks > 1) invalidGlb(`${label} contains duplicate JSON chunks.`);
    } else if (chunkType === GLB_BIN_CHUNK) {
      binChunks += 1;
      if (binChunks > 1) invalidGlb(`${label} contains duplicate BIN chunks.`);
    }
    offset += 8 + chunkLength;
    chunkIndex += 1;
  }
  if (offset !== bytes.byteLength || jsonChunks !== 1) {
    invalidGlb(`${label} has an invalid GLB chunk table.`);
  }
}

function ownDataValue(
  source: object,
  key: string,
  label: string,
  required = false,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor) {
    if (required) invalid(`${label}.${key} must be an own data property.`);
    return undefined;
  }
  if (!("value" in descriptor)) {
    invalid(`${label}.${key} must not be an accessor property.`);
  }
  return descriptor.value;
}

function ownArrayValues(source: readonly unknown[], label: string): unknown[] {
  const values: unknown[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
    if (!descriptor || !("value" in descriptor)) {
      invalid(`${label}[${index}] must be an own data property.`);
    }
    values.push(descriptor.value);
  }
  return values;
}

function finitePivot(pivotValue: unknown): StudioGltfTransformOperation {
  const pivot = pivotValue ?? "center";
  if (pivot === "center" || pivot === "above" || pivot === "below") {
    return { kind: "center", pivot };
  }
  if (
    !Array.isArray(pivot)
    || pivot.length !== 3
  ) {
    invalid("center.pivot must be a named pivot or bounded finite vec3.");
  }
  const components = ownArrayValues(pivot, "center.pivot");
  if (
    components.some(
      (component) =>
        !Number.isFinite(component)
        || typeof component !== "number"
        || Math.abs(component)
          > STUDIO_GLTF_TRANSFORM_BUDGETS.maxCoordinateMagnitude,
    )
  ) {
    invalid("center.pivot must be a named pivot or bounded finite vec3.");
  }
  return {
    kind: "center",
    pivot: [components[0] as number, components[1] as number, components[2] as number],
  };
}

function optionalBoolean(
  value: unknown,
  label: string,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") invalid(`${label} must be boolean.`);
  return value;
}

function prepareOperations(
  values: readonly StudioGltfTransformOperation[] | undefined,
): readonly StudioGltfTransformOperation[] {
  const operations = values ?? [];
  if (
    !Array.isArray(operations)
    || operations.length > STUDIO_GLTF_TRANSFORM_BUDGETS.maxOperations
  ) {
    invalid("operations exceeds the bounded transform pipeline.");
  }
  const kinds = new Set<string>();
  return ownArrayValues(operations, "operations").map((value, index) => {
    if (!value || typeof value !== "object") {
      invalid(`operations[${index}] is invalid.`);
    }
    const label = `operations[${index}]`;
    const kind = ownDataValue(value, "kind", label, true);
    if (typeof kind !== "string") {
      invalid(`${label}.kind is invalid.`);
    }
    if (kinds.has(kind)) {
      invalid(`${label} duplicates ${kind}.`);
    }
    kinds.add(kind);
    switch (kind) {
      case "dedup":
        return {
          kind: "dedup",
          keepUniqueNames: optionalBoolean(
            ownDataValue(value, "keepUniqueNames", label),
            "dedup.keepUniqueNames",
            false,
          ),
        };
      case "prune":
        return {
          kind: "prune",
          keepLeaves: optionalBoolean(
            ownDataValue(value, "keepLeaves", label),
            "prune.keepLeaves",
            false,
          ),
          keepAttributes: optionalBoolean(
            ownDataValue(value, "keepAttributes", label),
            "prune.keepAttributes",
            false,
          ),
          keepSolidTextures: optionalBoolean(
            ownDataValue(value, "keepSolidTextures", label),
            "prune.keepSolidTextures",
            false,
          ),
          keepExtras: optionalBoolean(
            ownDataValue(value, "keepExtras", label),
            "prune.keepExtras",
            false,
          ),
        };
      case "flatten":
        return {
          kind: "flatten",
          cleanup: optionalBoolean(
            ownDataValue(value, "cleanup", label),
            "flatten.cleanup",
            true,
          ),
        };
      case "center":
        return finitePivot(ownDataValue(value, "pivot", label));
      default:
        invalid(`operations[${index}] uses an unsupported transform.`);
    }
  });
}

function validateStats(
  value: StudioGltfTransformStats,
): StudioGltfTransformStats {
  if (!value || typeof value !== "object") {
    throw new StudioGltfTransformProviderError(
      "invalid-runtime-output",
      "glTF Transform runtime returned invalid document statistics.",
    );
  }
  const output = {} as Record<keyof StudioGltfTransformStats, number>;
  for (const key of Object.keys(STAT_BUDGETS) as (
    keyof StudioGltfTransformStats
  )[]) {
    const count = value[key];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new StudioGltfTransformProviderError(
        "invalid-runtime-output",
        `glTF Transform runtime returned an invalid ${key} count.`,
      );
    }
    if (count > STAT_BUDGETS[key]) {
      budget(`glTF document exceeds the ${key} budget.`);
    }
    output[key] = count;
  }
  return output;
}

function asProviderError(error: unknown): StudioGltfTransformProviderError {
  if (error instanceof StudioGltfTransformProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new StudioGltfTransformProviderError(
      "aborted",
      "glTF Transform operation was aborted.",
      { cause: error },
    );
  }
  return new StudioGltfTransformProviderError(
    "runtime-failed",
    "glTF Transform runtime failed.",
    { cause: error },
  );
}

export function createStudioGltfTransformProvider(
  options: Readonly<{
    epoch?: number;
    runtimeLoader?: StudioGltfTransformRuntimeLoader;
  }> = {},
): StudioGltfTransformProvider {
  const epoch = options.epoch ?? 0;
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    invalid("epoch must be a non-negative safe integer.");
  }
  const runtimeLoader = options.runtimeLoader ?? loadStudioGltfTransformRuntime;
  let state: "ready" | "destroying" | "destroyed" = "ready";
  let runtimePromise: Promise<StudioGltfTransformRuntime> | null = null;
  let runtime: StudioGltfTransformRuntime | null = null;
  let sequence = 0;
  let activeOperations = 0;
  let resolveIdle: (() => void) | null = null;
  let destroyPromise: Promise<void> | null = null;

  const loadRuntime = (): Promise<StudioGltfTransformRuntime> => {
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
      throw new StudioGltfTransformProviderError(
        "disposed",
        "glTF Transform provider is not ready.",
      );
    }
    aborted(signal);
    if (
      activeOperations
      >= STUDIO_GLTF_TRANSFORM_BUDGETS.maxConcurrentOperations
    ) {
      throw new StudioGltfTransformProviderError(
        "backpressure",
        "glTF Transform operation budget exceeded.",
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

  const provider: StudioGltfTransformProvider = {
    transform(input) {
      let inputBytes: Uint8Array;
      let operations: readonly StudioGltfTransformOperation[];
      let admittedSequence: number;
      let signal: AbortSignal | undefined;
      try {
        if (!input || typeof input !== "object") {
          invalid("A glTF Transform request is required.");
        }
        const glb = requestDataProperty(input, "glb") as
          | ArrayBuffer
          | ArrayBufferView;
        const epochValue = requestDataProperty(input, "epoch");
        const operationsValue = Object.hasOwn(input, "operations")
          ? requestDataProperty(input, "operations")
          : undefined;
        const signalValue = Object.hasOwn(input, "signal")
          ? requestDataProperty(input, "signal")
          : undefined;
        if (
          signalValue !== undefined
          && (
            typeof AbortSignal === "undefined"
            || !(signalValue instanceof AbortSignal)
          )
        ) {
          invalid("glTF Transform request.signal must be an AbortSignal.");
        }
        signal = signalValue as AbortSignal | undefined;
        inputBytes = copyBytes(
          glb,
          "glb",
          STUDIO_GLTF_TRANSFORM_BUDGETS.maxInputBytes,
        );
        validateGlb(
          inputBytes,
          STUDIO_GLTF_TRANSFORM_BUDGETS.maxInputBytes,
          "Input GLB",
        );
        if (!Number.isSafeInteger(epochValue) || epochValue !== epoch) {
          throw new StudioGltfTransformProviderError(
            "epoch-mismatch",
            "glTF Transform request epoch does not match.",
          );
        }
        operations = prepareOperations(
          operationsValue as readonly StudioGltfTransformOperation[] | undefined,
        );
        admittedSequence = enter(signal);
      } catch (error) {
        return Promise.reject(error);
      }
      return (async () => {
        let document: unknown = null;
        try {
          const loaded = await loadRuntime();
          aborted(signal);
          document = await loaded.readBinary(inputBytes);
          if (!document) {
            throw new StudioGltfTransformProviderError(
              "invalid-runtime-output",
              "glTF Transform runtime returned an empty Document handle.",
            );
          }
          aborted(signal);
          const before = validateStats(loaded.inspectDocument(document));
          for (const operation of operations) {
            aborted(signal);
            await loaded.transform(document, operation);
            aborted(signal);
            validateStats(loaded.inspectDocument(document));
          }
          const after = validateStats(loaded.inspectDocument(document));
          const runtimeOutput = await loaded.writeBinary(document);
          aborted(signal);
          if (!(runtimeOutput instanceof Uint8Array)) {
            throw new StudioGltfTransformProviderError(
              "invalid-runtime-output",
              "glTF Transform runtime returned non-binary output.",
            );
          }
          if (
            runtimeOutput.byteLength
            > STUDIO_GLTF_TRANSFORM_BUDGETS.maxOutputBytes
          ) {
            budget("Output GLB exceeds the GLB byte budget.");
          }
          const outputBytes = new Uint8Array(
            runtimeOutput.buffer.slice(
              runtimeOutput.byteOffset,
              runtimeOutput.byteOffset + runtimeOutput.byteLength,
            ),
          );
          validateGlb(
            outputBytes,
            STUDIO_GLTF_TRANSFORM_BUDGETS.maxOutputBytes,
            "Output GLB",
          );
          const inputRecord = {
            byteLength: inputBytes.byteLength,
            hash: hashBytes(inputBytes),
          };
          const outputRecord = {
            byteLength: outputBytes.byteLength,
            hash: hashBytes(outputBytes),
          };
          const receiptWithoutHash = {
            kind: "studio-gltf-transform-receipt" as const,
            revision: STUDIO_GLTF_TRANSFORM_PROVIDER_REVISION,
            providerId: "gltf-transform" as const,
            runtimeVersion: loaded.version,
            epoch,
            sequence: admittedSequence,
            operations,
            input: inputRecord,
            output: outputRecord,
            before,
            after,
          };
          return {
            ...receiptWithoutHash,
            output: { ...outputRecord, glb: outputBytes },
            receiptHash: hashBytes(
              new TextEncoder().encode(JSON.stringify(receiptWithoutHash)),
            ),
          };
        } catch (error) {
          throw asProviderError(error);
        } finally {
          if (document && runtime) {
            try {
              runtime.destroyDocument(document);
            } catch {
              // The original result/error wins; all references are dropped below.
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

type GltfCoreModule = typeof import("@gltf-transform/core");
type GltfExtensionsModule = typeof import("@gltf-transform/extensions");
type GltfFunctionsModule = typeof import("@gltf-transform/functions");
type GltfDocument = import("@gltf-transform/core").Document;
type GltfProperty = import("@gltf-transform/core").Property;

function createGltfTransformRuntime(
  core: GltfCoreModule,
  extensions: GltfExtensionsModule,
  functions: GltfFunctionsModule,
): StudioGltfTransformRuntime {
  const io = new core.WebIO()
    .registerExtensions(extensions.KHRONOS_EXTENSIONS)
    .setStrictResources(true);

  return {
    version: "gltf-transform-4.4.2",
    readBinary(bytes) {
      return io.readBinary(bytes);
    },
    inspectDocument(documentValue) {
      const root = (documentValue as GltfDocument).getRoot();
      const meshes = root.listMeshes();
      const textures = root.listTextures();
      const accessors = root.listAccessors();
      return {
        scenes: root.listScenes().length,
        nodes: root.listNodes().length,
        meshes: meshes.length,
        primitives: meshes.reduce(
          (sum, mesh) => sum + mesh.listPrimitives().length,
          0,
        ),
        materials: root.listMaterials().length,
        textures: textures.length,
        animations: root.listAnimations().length,
        accessors: accessors.length,
        accessorElements: accessors.reduce(
          (sum, accessor) => sum + accessor.getCount(),
          0,
        ),
        textureBytes: textures.reduce(
          (sum, texture) => sum + (texture.getImage()?.byteLength ?? 0),
          0,
        ),
        buffers: root.listBuffers().length,
        skins: root.listSkins().length,
        cameras: root.listCameras().length,
      };
    },
    async transform(documentValue, operation) {
      const document = documentValue as GltfDocument;
      switch (operation.kind) {
        case "dedup":
          await document.transform(functions.dedup({
            keepUniqueNames: operation.keepUniqueNames,
          }));
          return;
        case "prune":
          await document.transform(functions.prune({
            keepLeaves: operation.keepLeaves,
            keepAttributes: operation.keepAttributes,
            keepSolidTextures: operation.keepSolidTextures,
            keepExtras: operation.keepExtras,
          }));
          return;
        case "flatten":
          await document.transform(functions.flatten({
            cleanup: operation.cleanup,
          }));
          return;
        case "center": {
          const pivot = operation.pivot;
          await document.transform(functions.center({
            pivot: pivot === undefined || typeof pivot === "string"
              ? pivot
              : [pivot[0], pivot[1], pivot[2]],
          }));
        }
      }
    },
    writeBinary(document) {
      return io.writeBinary(document as GltfDocument);
    },
    destroyDocument(documentValue) {
      const root = (documentValue as GltfDocument).getRoot();
      const extensionsUsed = [...root.listExtensionsUsed()];
      const properties: GltfProperty[] = [
        ...root.listScenes(),
        ...root.listAnimations(),
        ...root.listSkins(),
        ...root.listNodes(),
        ...root.listMeshes(),
        ...root.listMaterials(),
        ...root.listTextures(),
        ...root.listAccessors(),
        ...root.listBuffers(),
        ...root.listCameras(),
      ];
      for (const property of properties) property.dispose();
      for (const extension of extensionsUsed) extension.dispose();
    },
    destroy() {
      // WebIO and transform factories do not retain per-document resources.
    },
  };
}

/** Loads only the browser-safe glTF Transform adapters on first use. */
export async function loadStudioGltfTransformRuntime():
Promise<StudioGltfTransformRuntime> {
  const [core, extensions, functions] = await Promise.all([
    import("@gltf-transform/core"),
    import("@gltf-transform/extensions"),
    import("@gltf-transform/functions"),
  ]);
  return createGltfTransformRuntime(core, extensions, functions);
}
