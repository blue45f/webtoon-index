/**
 * Production-only xatlasjs adapter.
 *
 * xatlasjs ships its browser API as a Comlink-exposed worker bundle. Importing
 * that bundle directly inside the Studio provider Worker would normally expose
 * it to the parent page. The small loopback below keeps that package API in the
 * same dedicated Worker: package messages are dispatched locally and only
 * Studio protocol messages cross the Worker boundary. No nested Worker exists.
 */

import xatlasModuleUrl from "xatlasjs/dist/xatlas.js?url";
import xatlasWasmUrl from "xatlasjs/dist/xatlas.wasm?url";

import type {
  StudioXAtlasUvRuntime,
  StudioXAtlasUvRuntimeAssets,
  StudioXAtlasUvRuntimeAtlas,
  StudioXAtlasUvRuntimeGeometry,
  StudioXAtlasUvRuntimeMeshInput,
  StudioXAtlasUvRuntimeMeshOutput,
  StudioXAtlasUvRuntimePackOptions,
} from "./studio-xatlas-uv-provider";

type WorkerPostMessage = (message: unknown, transfer?: readonly Transferable[]) => void;

interface WorkerScopeView extends EventTarget {
  postMessage: WorkerPostMessage;
}

interface ComlinkRawWireValue {
  readonly type: "RAW";
  readonly value: unknown;
}

interface ComlinkHandlerWireValue {
  readonly type: "HANDLER";
  readonly name: string;
  readonly value: unknown;
}

type ComlinkWireValue = ComlinkRawWireValue | ComlinkHandlerWireValue;
type ComlinkMessage = ComlinkWireValue & { readonly id: string };

interface ComlinkRequest {
  readonly id: string;
  readonly type: "GET" | "APPLY" | "CONSTRUCT" | "RELEASE";
  readonly path: readonly string[];
  readonly argumentList?: readonly ComlinkWireValue[];
}

interface CallbackResource {
  readonly wire: ComlinkHandlerWireValue;
  close(): void;
}

interface XAtlasMeshResult {
  readonly mesh: unknown;
  readonly index: unknown;
  readonly vertex: {
    readonly vertices?: unknown;
    readonly coords1?: unknown;
  };
  readonly subMeshes?: unknown;
}

interface XAtlasResult {
  readonly width: unknown;
  readonly height: unknown;
  readonly atlasCount: unknown;
  readonly meshCount: unknown;
  readonly texelsPerUnit: unknown;
  readonly meshes: unknown;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!isObject(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function raw(value: unknown): ComlinkRawWireValue {
  return { type: "RAW", value };
}

function workerScope(): WorkerScopeView {
  const candidate = globalThis as unknown as Partial<WorkerScopeView> & {
    readonly close?: unknown;
    readonly document?: unknown;
  };
  if (
    typeof candidate.document !== "undefined"
    || typeof candidate.close !== "function"
    || typeof candidate.postMessage !== "function"
    || typeof candidate.addEventListener !== "function"
    || typeof candidate.dispatchEvent !== "function"
  ) {
    throw new Error("xatlasjs production runtime requires a dedicated Worker");
  }
  return candidate as WorkerScopeView;
}

function comlinkError(value: unknown): Error {
  if (
    isRecord(value)
    && value.isError === true
    && isRecord(value.value)
    && typeof value.value.message === "string"
  ) {
    const error = new Error(value.value.message);
    if (typeof value.value.name === "string") error.name = value.value.name;
    return error;
  }
  return new Error(typeof value === "string" ? value : "xatlasjs package API rejected");
}

function decodeWire(message: ComlinkWireValue): unknown {
  if (message.type === "RAW") return message.value;
  if (message.name === "throw") throw comlinkError(message.value);
  throw new TypeError(`xatlasjs returned an unsupported Comlink handler: ${message.name}`);
}

function callbackResource(
  callback: (...values: readonly unknown[]) => unknown,
): CallbackResource {
  const channel = new MessageChannel();
  const listener = (event: MessageEvent<unknown>): void => {
    if (
      !isRecord(event.data)
      || typeof event.data.id !== "string"
      || event.data.type !== "APPLY"
      || !Array.isArray(event.data.argumentList)
    ) {
      return;
    }
    const id = event.data.id;
    const argumentList = event.data.argumentList;
    void Promise.resolve().then(() => {
      const values = argumentList.map((value: unknown) => {
        if (!isRecord(value) || (value.type !== "RAW" && value.type !== "HANDLER")) {
          throw new TypeError("xatlasjs callback received a malformed wire value");
        }
        return decodeWire(value as unknown as ComlinkWireValue);
      });
      return callback(...values);
    }).then((value) => {
      channel.port1.postMessage({ id, ...raw(value) });
    }).catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      channel.port1.postMessage({
        id,
        type: "HANDLER",
        name: "throw",
        value: {
          isError: true,
          value: {
            message: normalized.message,
            name: normalized.name,
            stack: normalized.stack,
          },
        },
      });
    });
  };
  channel.port1.addEventListener("message", listener);
  channel.port1.start();
  return {
    wire: {
      type: "HANDLER",
      name: "proxy",
      value: channel.port2,
    },
    close: () => {
      channel.port1.removeEventListener("message", listener);
      channel.port1.close();
      channel.port2.close();
    },
  };
}

class ComlinkPortClient {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<
    string,
    { readonly resolve: (message: ComlinkMessage) => void; readonly reject: (error: Error) => void }
  >();

  constructor(private readonly port: MessagePort) {
    this.port.addEventListener("message", this.onMessage);
    this.port.addEventListener("messageerror", this.onMessageError);
    this.port.start();
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (
      !isRecord(event.data)
      || typeof event.data.id !== "string"
      || (event.data.type !== "RAW" && event.data.type !== "HANDLER")
    ) {
      return;
    }
    const pending = this.pending.get(event.data.id);
    if (pending === undefined) return;
    this.pending.delete(event.data.id);
    pending.resolve(event.data as unknown as ComlinkMessage);
  };

  private readonly onMessageError = (): void => {
    this.fail(new Error("xatlasjs package API returned an uncloneable message"));
  };

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private request(
    type: ComlinkRequest["type"],
    path: readonly string[],
    values: readonly unknown[] = [],
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("xatlasjs package API is closed"));
    const id = `studio-xatlas-port-${this.nextId}`;
    this.nextId = this.nextId >= Number.MAX_SAFE_INTEGER ? 1 : this.nextId + 1;
    return new Promise<ComlinkMessage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.port.postMessage({
          id,
          type,
          path,
          ...(values.length === 0 ? {} : { argumentList: values.map(raw) }),
        } satisfies ComlinkRequest);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }).then(decodeWire);
  }

  get(path: string): Promise<unknown> {
    return this.request("GET", [path]);
  }

  call(path: string, values: readonly unknown[] = []): Promise<unknown> {
    return this.request("APPLY", [path], values);
  }

  async release(): Promise<void> {
    if (this.closed) return;
    try {
      await this.request("RELEASE", []);
    } finally {
      this.closed = true;
      this.fail(new Error("xatlasjs package API was released"));
      this.port.removeEventListener("message", this.onMessage);
      this.port.removeEventListener("messageerror", this.onMessageError);
      this.port.close();
    }
  }
}

class XAtlasPackageLoopback {
  private nextId = 1;
  private readonly pending = new Map<
    string,
    { readonly resolve: (message: ComlinkMessage) => void; readonly reject: (error: Error) => void }
  >();
  private readonly originalPostMessage: WorkerPostMessage;

  constructor(private readonly scope: WorkerScopeView) {
    this.originalPostMessage = scope.postMessage.bind(scope);
    const routedPostMessage: WorkerPostMessage = (message, transfer) => {
      if (
        isRecord(message)
        && typeof message.id === "string"
        && (message.type === "RAW" || message.type === "HANDLER")
      ) {
        const pending = this.pending.get(message.id);
        if (pending !== undefined) {
          this.pending.delete(message.id);
          pending.resolve(message as unknown as ComlinkMessage);
          return;
        }
      }
      this.originalPostMessage(message, transfer);
    };
    if (!Reflect.set(scope, "postMessage", routedPostMessage)) {
      throw new Error("xatlasjs package loopback could not route Worker messages");
    }
  }

  private request(
    type: ComlinkRequest["type"],
    argumentList: readonly ComlinkWireValue[],
  ): Promise<ComlinkMessage> {
    const id = `studio-xatlas-root-${this.nextId}`;
    this.nextId = this.nextId >= Number.MAX_SAFE_INTEGER ? 1 : this.nextId + 1;
    return new Promise<ComlinkMessage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.scope.dispatchEvent(new MessageEvent("message", {
          data: {
            id,
            type,
            path: [],
            ...(argumentList.length === 0 ? {} : { argumentList }),
          } satisfies ComlinkRequest,
        }));
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async construct(
    wasmUrl: string,
    onProgress: (mode: unknown, progress: unknown) => void,
  ): Promise<{ readonly api: ComlinkPortClient; readonly callbacks: readonly CallbackResource[] }> {
    const locateFile = callbackResource((path) => (
      path === "xatlas.wasm" ? wasmUrl : String(path)
    ));
    const progress = callbackResource((mode, value) => {
      onProgress(mode, value);
    });
    try {
      const response = await this.request("CONSTRUCT", [
        raw(undefined),
        locateFile.wire,
        progress.wire,
      ]);
      if (
        response.type !== "HANDLER"
        || response.name !== "proxy"
        || !(response.value instanceof MessagePort)
      ) {
        decodeWire(response);
        throw new TypeError("xatlasjs package did not expose an API instance");
      }
      return {
        api: new ComlinkPortClient(response.value),
        callbacks: [locateFile, progress],
      };
    } catch (error) {
      locateFile.close();
      progress.close();
      throw error;
    }
  }
}

let packageLoopback: XAtlasPackageLoopback | null = null;
let packageModuleUrl: string | null = null;
let packageLoad: Promise<XAtlasPackageLoopback> | null = null;

async function loadPackage(moduleUrl: string): Promise<XAtlasPackageLoopback> {
  if (packageLoopback !== null) {
    if (packageModuleUrl !== moduleUrl) {
      throw new Error("xatlasjs package module URL cannot change within one Worker");
    }
    return packageLoopback;
  }
  if (packageLoad !== null) return packageLoad;
  packageModuleUrl = moduleUrl;
  packageLoad = (async () => {
    const loopback = new XAtlasPackageLoopback(workerScope());
    await import(/* @vite-ignore */ moduleUrl);
    packageLoopback = loopback;
    return loopback;
  })();
  try {
    return await packageLoad;
  } catch (error) {
    packageLoad = null;
    packageModuleUrl = null;
    throw error;
  }
}

class ProductionGeometry implements StudioXAtlasUvRuntimeGeometry {
  private released = false;

  constructor(
    readonly id: string,
    readonly input: StudioXAtlasUvRuntimeMeshInput,
    private readonly onRelease: (geometry: ProductionGeometry) => void,
  ) {}

  release(): void {
    if (this.released) return;
    this.released = true;
    this.onRelease(this);
  }
}

function arrayLike(value: unknown, name: string): ArrayLike<number> {
  if (!isObject(value) || !("length" in value)) {
    throw new TypeError(`xatlasjs returned an invalid ${name}`);
  }
  return value as ArrayLike<number>;
}

function meshResult(value: unknown, id: string): XAtlasMeshResult {
  if (
    !isRecord(value)
    || value.mesh !== id
    || !isRecord(value.vertex)
  ) {
    throw new TypeError(`xatlasjs returned an invalid mesh for ${id}`);
  }
  return value as unknown as XAtlasMeshResult;
}

const XATLAS_PROGRESS_MODES = Object.freeze([
  "add-mesh",
  "compute-charts",
  "pack-charts",
  "build-output-meshes",
] as const);

function progressMode(value: unknown): unknown {
  if (
    typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value < XATLAS_PROGRESS_MODES.length
  ) {
    return XATLAS_PROGRESS_MODES[value];
  }
  return value;
}

class ProductionRuntime implements StudioXAtlasUvRuntime {
  readonly packageVersion = "0.2.0";
  private api: ComlinkPortClient | null = null;
  private callbacks: readonly CallbackResource[] = [];
  private initialized = false;
  private atlasNeedsCleanup = false;
  private activeProgress: ((mode: unknown, progress: unknown) => void) | null = null;
  private readonly geometries = new Set<ProductionGeometry>();

  async initialize(
    assets: StudioXAtlasUvRuntimeAssets | null,
    onProgress: (mode: unknown, progress: unknown) => void,
  ): Promise<void> {
    if (this.initialized) return;
    const moduleUrl = assets?.moduleUrl ?? xatlasModuleUrl;
    const wasmUrl = assets?.wasmUrl ?? xatlasWasmUrl;
    this.activeProgress = onProgress;
    onProgress("load", 0);
    const loopback = await loadPackage(moduleUrl);
    const { api, callbacks } = await loopback.construct(
      wasmUrl,
      (mode, progress) => this.activeProgress?.(progressMode(mode), progress),
    );
    this.api = api;
    this.callbacks = callbacks;
    while (await api.get("loaded") !== true) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    this.initialized = true;
    onProgress("load", 1);
    this.activeProgress = null;
  }

  createGeometry(mesh: StudioXAtlasUvRuntimeMeshInput): StudioXAtlasUvRuntimeGeometry {
    if (!this.initialized) throw new Error("xatlasjs runtime is not initialized");
    const resource = new ProductionGeometry(mesh.id, mesh, () => {
      this.geometries.delete(resource);
    });
    this.geometries.add(resource);
    return resource;
  }

  async pack(
    geometries: readonly StudioXAtlasUvRuntimeGeometry[],
    options: StudioXAtlasUvRuntimePackOptions,
    onProgress: (mode: unknown, progress: unknown) => void,
  ): Promise<StudioXAtlasUvRuntimeAtlas> {
    const api = this.api;
    if (!this.initialized || api === null) throw new Error("xatlasjs runtime is not initialized");
    const productionGeometries = geometries.map((geometry) => {
      if (!(geometry instanceof ProductionGeometry) || !this.geometries.has(geometry)) {
        throw new TypeError("xatlasjs received a foreign geometry handle");
      }
      return geometry;
    });
    this.activeProgress = onProgress;
    await api.call("setProgressLogging", [false]);
    await api.call("createAtlas");
    this.atlasNeedsCleanup = true;
    try {
      for (const geometry of productionGeometries) {
        const input = geometry.input;
        const added = await api.call("addMesh", [
          input.indices instanceof Uint16Array
            ? input.indices
            : new Uint16Array(input.indices),
          input.positions,
          input.normals,
          input.uv,
          input.id,
          options.useNormals,
          options.chart.useInputMeshUvs === true,
          1,
        ]);
        if (added === null) throw new Error(`xatlasjs rejected mesh ${input.id}`);
      }
      const candidate = await api.call("generateAtlas", [
        { ...options.chart },
        {
          resolution: options.pack.resolution,
          padding: options.pack.padding,
          rotateCharts: options.pack.rotateCharts,
          createImage: false,
          bruteForce: false,
          ...(options.pack.texelsPerUnit === null
            ? {}
            : { texelsPerUnit: options.pack.texelsPerUnit }),
        },
        true,
      ]);
      if (!isRecord(candidate) || !Array.isArray(candidate.meshes)) {
        throw new TypeError("xatlasjs returned an invalid atlas");
      }
      const atlas = candidate as unknown as XAtlasResult;
      const results = candidate.meshes;
      if (results.length !== productionGeometries.length) {
        throw new TypeError("xatlasjs returned the wrong mesh count");
      }
      const meshes: StudioXAtlasUvRuntimeMeshOutput[] = productionGeometries.map(
        (geometry, index) => {
          const result = meshResult(results[index], geometry.id);
          const segments = result.subMeshes;
          return {
            id: geometry.id,
            positions: arrayLike(result.vertex.vertices, `${geometry.id} positions`),
            uv: arrayLike(result.vertex.coords1, `${geometry.id} uv`),
            indices: arrayLike(result.index, `${geometry.id} indices`),
            atlasSegments: Array.isArray(segments)
              ? segments.map((segment) => {
                if (!isRecord(segment)) {
                  throw new TypeError(`xatlasjs returned an invalid ${geometry.id} sub-mesh`);
                }
                return {
                  index: segment.index as number,
                  count: segment.count as number,
                  atlasIndex: segment.atlasIndex as number,
                };
              })
              : [],
          };
        },
      );
      return {
        width: atlas.width,
        height: atlas.height,
        atlasCount: atlas.atlasCount,
        meshCount: atlas.meshCount,
        texelsPerUnit: atlas.texelsPerUnit,
        meshes,
      } as StudioXAtlasUvRuntimeAtlas;
    } finally {
      this.activeProgress = null;
    }
  }

  async cleanupAtlas(): Promise<boolean> {
    if (!this.atlasNeedsCleanup) return true;
    const api = this.api;
    if (api === null) return false;
    try {
      await api.call("destroyAtlas");
      this.atlasNeedsCleanup = false;
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    await this.cleanupAtlas();
    for (const geometry of [...this.geometries].reverse()) geometry.release();
    const api = this.api;
    this.api = null;
    this.initialized = false;
    if (api !== null) await api.release().catch(() => undefined);
    for (const callback of this.callbacks) callback.close();
    this.callbacks = [];
    // The Emscripten module has no dispose API. Terminating this containing
    // dedicated Worker is the authoritative WASM memory cleanup boundary.
  }
}

export function createStudioXAtlasUvProductionRuntime(): StudioXAtlasUvRuntime {
  return new ProductionRuntime();
}
