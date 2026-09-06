import { sha256HexPortable } from "../studio-sha256";
import { downloadStudioWorkAsset } from "../studio-work-asset-client";

import {
  normalizeStudioBrushR8TextureGrainSource,
  serializeStudioBrushR8TextureGrainSourceCanonical,
  type StudioBrushR8TextureGrainSource,
} from "./studio-brush-r8-grain-asset-contract";
import {
  hydrateStudioBrushR8GrainAsset,
  releaseStudioBrushR8GrainAsset,
  resetStudioBrushR8GrainRegistry,
  resolveStudioBrushR8GrainSampler,
  type StudioBrushR8GrainHydrationResult,
} from "./studio-brush-r8-grain-runtime";
import { createStudioBrushR8PngDecoder } from "./studio-brush-r8-png-decoder";

import type { DownloadedStudioWorkAsset } from "../studio-work-asset-client";

export interface StudioBrushR8GrainPageLike {
  readonly elements: readonly unknown[];
}

export interface StudioBrushR8GrainSourceCollectionInput {
  /** The snapshot currently owned by the editor's history cursor. */
  readonly currentPages: readonly StudioBrushR8GrainPageLike[];
  /** Optional history frontier; only `historyIndex` is authoritative and therefore inspected. */
  readonly history?: readonly (readonly StudioBrushR8GrainPageLike[])[];
  readonly historyIndex?: number;
  /** Document-master or other authoritative draw elements rendered with the current page. */
  readonly extraElements?: readonly unknown[];
}

export interface StudioBrushR8DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorModel: string;
  readonly components: number;
  readonly channels: number;
  readonly alpha: boolean;
  getValueByIndex(index: number, channel: number): number;
}

export type StudioBrushR8PngDecoder = (
  bytes: Uint8Array,
) => StudioBrushR8DecodedPng | Promise<StudioBrushR8DecodedPng>;

export type StudioBrushR8GrainHydrationErrorCode =
  | "asset-contract"
  | "encoded-integrity"
  | "decode"
  | "registry"
  | "request";

export interface StudioBrushR8GrainHydrationErrorState {
  readonly sourceKey: string;
  readonly assetId: string;
  readonly code: StudioBrushR8GrainHydrationErrorCode;
  readonly message: string;
}

export interface StudioBrushR8GrainHydratorSnapshot {
  readonly version: number;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly observed: number;
  readonly pending: number;
  readonly ready: number;
  readonly unavailable: number;
  readonly errors: readonly Readonly<StudioBrushR8GrainHydrationErrorState>[];
  readonly canRetry: boolean;
}

export interface StudioBrushR8GrainHydratorDependencies {
  readonly download?: (
    workId: string,
    reference: { assetId: string; elementType: "image" },
    signal: AbortSignal,
  ) => Promise<DownloadedStudioWorkAsset>;
  readonly decodePng?: StudioBrushR8PngDecoder;
  readonly hydrate?: (
    source: unknown,
    decodedBytes: unknown,
  ) => StudioBrushR8GrainHydrationResult;
  readonly resolve?: typeof resolveStudioBrushR8GrainSampler;
  readonly release?: typeof releaseStudioBrushR8GrainAsset;
  readonly reset?: typeof resetStudioBrushR8GrainRegistry;
  readonly maximumConcurrent?: number;
}

interface StudioBrushR8GrainHydrationItem {
  readonly sourceKey: string;
  readonly source: Readonly<StudioBrushR8TextureGrainSource>;
  readonly status: "loading" | "ready" | "unavailable" | "error";
  readonly error?: Readonly<StudioBrushR8GrainHydrationErrorState>;
}

interface StudioBrushR8GrainHydrationRun {
  readonly generation: number;
  readonly controller: AbortController;
}

const DEFAULT_MAXIMUM_CONCURRENT = 3;
const MAXIMUM_CONCURRENT_LIMIT = 8;

const defaultDecodePng = createStudioBrushR8PngDecoder(() => import("image-js"));

function ownDataValue(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function sourceFromDrawElement(
  element: unknown,
): Readonly<StudioBrushR8TextureGrainSource> | null {
  if (ownDataValue(element, "type") !== "draw") return null;
  const dynamics = ownDataValue(element, "brushDynamics");
  const grain = ownDataValue(dynamics, "grain");
  return normalizeStudioBrushR8TextureGrainSource(ownDataValue(grain, "source"));
}

function appendCanonicalSources(
  target: Map<string, Readonly<StudioBrushR8TextureGrainSource>>,
  elements: readonly unknown[],
): void {
  for (const element of elements) {
    const source = sourceFromDrawElement(element);
    const sourceKey = source
      ? serializeStudioBrushR8TextureGrainSourceCanonical(source)
      : null;
    if (source && sourceKey && !target.has(sourceKey)) target.set(sourceKey, source);
  }
}

/**
 * Collects only strict non-null R8 sources from the editor's current authority. Older undo/redo
 * snapshots are intentionally ignored until they become the history cursor, preventing stale
 * private assets from being fetched speculatively.
 */
export function collectStudioBrushR8GrainSources(
  input: StudioBrushR8GrainSourceCollectionInput,
): readonly Readonly<StudioBrushR8TextureGrainSource>[] {
  const sources = new Map<string, Readonly<StudioBrushR8TextureGrainSource>>();
  for (const page of input.currentPages) appendCanonicalSources(sources, page.elements);
  if (
    input.history
    && Number.isSafeInteger(input.historyIndex)
    && (input.historyIndex ?? -1) >= 0
    && (input.historyIndex ?? -1) < input.history.length
  ) {
    for (const page of input.history[input.historyIndex!] ?? []) {
      appendCanonicalSources(sources, page.elements);
    }
  }
  appendCanonicalSources(sources, input.extraElements ?? []);
  return Object.freeze([...sources.values()]);
}

/**
 * Replaces only R8 draw element references. This is a deliberate memo invalidation boundary:
 * `StudioDrawNode` keeps ordinary committed strokes reference-stable, while a hydration completion
 * must recompute the previously fail-closed R8 coverage plan exactly once.
 */
export function projectStudioBrushR8GrainRenderElements<T>(
  elements: readonly T[],
  hydrationRevision: number,
): T[] {
  void hydrationRevision;
  return elements.map((element) =>
    sourceFromDrawElement(element)
      ? ({ ...(element as object) } as T)
      : element
  );
}

function canonicalSources(
  sourceValues: readonly unknown[],
): Map<string, Readonly<StudioBrushR8TextureGrainSource>> {
  const sources = new Map<string, Readonly<StudioBrushR8TextureGrainSource>>();
  for (const sourceValue of sourceValues) {
    const source = normalizeStudioBrushR8TextureGrainSource(sourceValue);
    const sourceKey = source
      ? serializeStudioBrushR8TextureGrainSourceCanonical(source)
      : null;
    if (source && sourceKey && !sources.has(sourceKey)) sources.set(sourceKey, source);
  }
  return sources;
}

function exactChannelValue(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("PNG 채널 값이 8-bit 범위를 벗어났습니다.");
  }
  return value;
}

/**
 * Deterministic PNG→R8 extraction. Alpha assets require an actual alpha channel; luminance uses
 * direct GREY values or fixed integer BT.709 weights (54R + 183G + 19B + 128) / 256.
 */
export async function decodeStudioBrushR8GrainPng(
  sourceValue: unknown,
  encodedBytes: Uint8Array,
  decodePng: StudioBrushR8PngDecoder = defaultDecodePng,
): Promise<Uint8Array> {
  const source = normalizeStudioBrushR8TextureGrainSource(sourceValue);
  if (!source) throw new Error("R8 질감 소스 계약이 올바르지 않습니다.");
  let image: StudioBrushR8DecodedPng;
  try {
    image = await decodePng(encodedBytes);
  } catch (cause) {
    throw new Error("R8 질감 PNG를 디코드하지 못했습니다.", { cause });
  }
  if (
    image.bitDepth !== 8
    || image.width !== source.asset.width
    || image.height !== source.asset.height
  ) {
    throw new Error("R8 질감 PNG의 비트 깊이 또는 고유 크기가 선언과 다릅니다.");
  }
  const pixels = source.asset.width * source.asset.height;
  const output = new Uint8Array(pixels);
  if (source.asset.channel === "alpha") {
    if (
      !image.alpha
      || image.channels !== image.components + 1
      || (image.colorModel !== "GREYA" && image.colorModel !== "RGBA")
    ) {
      throw new Error("alpha R8 질감 PNG에 실제 알파 채널이 없습니다.");
    }
    const alphaChannel = image.channels - 1;
    for (let index = 0; index < pixels; index += 1) {
      output[index] = exactChannelValue(image.getValueByIndex(index, alphaChannel));
    }
    return output;
  }

  if (
    image.components === 1
    && (image.colorModel === "GREY" || image.colorModel === "GREYA")
  ) {
    for (let index = 0; index < pixels; index += 1) {
      output[index] = exactChannelValue(image.getValueByIndex(index, 0));
    }
    return output;
  }
  if (
    image.components !== 3
    || (image.colorModel !== "RGB" && image.colorModel !== "RGBA")
  ) {
    throw new Error("luminance R8 질감 PNG의 색상 모델이 지원되지 않습니다.");
  }
  for (let index = 0; index < pixels; index += 1) {
    const red = exactChannelValue(image.getValueByIndex(index, 0));
    const green = exactChannelValue(image.getValueByIndex(index, 1));
    const blue = exactChannelValue(image.getValueByIndex(index, 2));
    output[index] = (54 * red + 183 * green + 19 * blue + 128) >> 8;
  }
  return output;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256HexPortable(bytes);
  try {
    const exactBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(exactBuffer).set(bytes);
    const digest = await subtle.digest("SHA-256", exactBuffer);
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return sha256HexPortable(bytes);
  }
}

function hydrationError(
  sourceKey: string,
  source: Readonly<StudioBrushR8TextureGrainSource>,
  code: StudioBrushR8GrainHydrationErrorCode,
  cause: unknown,
): Readonly<StudioBrushR8GrainHydrationErrorState> {
  return Object.freeze({
    sourceKey,
    assetId: source.asset.assetId,
    code,
    message: cause instanceof Error ? cause.message : "R8 브러시 질감을 불러오지 못했습니다.",
  });
}

function abortError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "name" in error
    && error.name === "AbortError",
  );
}

async function verifiedEncodedBytes(
  source: Readonly<StudioBrushR8TextureGrainSource>,
  downloaded: DownloadedStudioWorkAsset,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const { manifest, blob } = downloaded;
  const expectedEncodedSha256 = source.asset.encodedSha256.slice("sha256:".length);
  if (
    manifest.assetId !== source.asset.assetId
    || manifest.elementType !== "image"
    || manifest.descriptor.element.id !== source.asset.assetId
    || manifest.descriptor.element.type !== "image"
    || manifest.mimeType !== "image/png"
    || manifest.mimeType !== source.asset.mediaType
    || manifest.byteSize !== source.asset.byteLength
    || manifest.sha256 !== expectedEncodedSha256
    || blob.type !== "image/png"
    || blob.size !== source.asset.byteLength
    || manifest.intrinsicImage?.width !== source.asset.width
    || manifest.intrinsicImage.height !== source.asset.height
    || manifest.intrinsicImage.decodedRgbaBytes
      !== source.asset.width * source.asset.height * 4
  ) {
    throw new Error("R8 질감 에셋 manifest가 저장된 브러시 계약과 정확히 일치하지 않습니다.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (signal.aborted) throw signal.reason;
  if (
    bytes.byteLength !== source.asset.byteLength
    || await sha256Hex(bytes) !== expectedEncodedSha256
  ) {
    throw new Error("R8 질감 PNG 바이트 무결성 검증에 실패했습니다.");
  }
  return bytes;
}

/**
 * Product lifecycle owner for persisted R8 paper textures. It never invents a URL and never
 * treats an unverified local source as renderable. Work switches abort late responses and wipe the
 * realm registry so one work cannot retain another work's decoded private bytes.
 */
export class StudioBrushR8GrainHydrator {
  private workId: string | null = null;
  private generation = 0;
  private version = 0;
  private disposed = false;
  private signature = "";
  private desired = new Map<string, Readonly<StudioBrushR8TextureGrainSource>>();
  private readonly items = new Map<string, StudioBrushR8GrainHydrationItem>();
  private readonly listeners = new Set<() => void>();
  private run: StudioBrushR8GrainHydrationRun | null = null;
  private snapshot: Readonly<StudioBrushR8GrainHydratorSnapshot> = Object.freeze({
    version: 0,
    status: "idle",
    observed: 0,
    pending: 0,
    ready: 0,
    unavailable: 0,
    errors: Object.freeze([]),
    canRetry: false,
  });
  private readonly download: NonNullable<StudioBrushR8GrainHydratorDependencies["download"]>;
  private readonly decodePng: StudioBrushR8PngDecoder;
  private readonly hydrate: NonNullable<StudioBrushR8GrainHydratorDependencies["hydrate"]>;
  private readonly resolve: NonNullable<StudioBrushR8GrainHydratorDependencies["resolve"]>;
  private readonly release: NonNullable<StudioBrushR8GrainHydratorDependencies["release"]>;
  private readonly reset: NonNullable<StudioBrushR8GrainHydratorDependencies["reset"]>;
  private readonly maximumConcurrent: number;

  constructor(dependencies: StudioBrushR8GrainHydratorDependencies = {}) {
    this.download = dependencies.download ?? downloadStudioWorkAsset;
    this.decodePng = dependencies.decodePng ?? defaultDecodePng;
    this.hydrate = dependencies.hydrate ?? hydrateStudioBrushR8GrainAsset;
    this.resolve = dependencies.resolve ?? resolveStudioBrushR8GrainSampler;
    this.release = dependencies.release ?? releaseStudioBrushR8GrainAsset;
    this.reset = dependencies.reset ?? resetStudioBrushR8GrainRegistry;
    const concurrency = dependencies.maximumConcurrent;
    this.maximumConcurrent = Number.isSafeInteger(concurrency) && (concurrency ?? 0) > 0
      ? Math.min(concurrency as number, MAXIMUM_CONCURRENT_LIMIT)
      : DEFAULT_MAXIMUM_CONCURRENT;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  getSnapshot = (): Readonly<StudioBrushR8GrainHydratorSnapshot> => this.snapshot;

  observe(workId: string | null, sourceValues: readonly unknown[]): void {
    if (this.disposed) return;
    const desired = canonicalSources(sourceValues);
    const signature = [...desired.keys()].join("\n");
    const workChanged = workId !== this.workId;
    if (!workChanged && signature === this.signature) return;

    this.abortRun();
    if (workChanged) {
      this.reset();
      this.items.clear();
    } else {
      for (const [sourceKey, source] of this.desired) {
        if (!desired.has(sourceKey)) {
          this.release(source);
          this.items.delete(sourceKey);
        }
      }
    }
    this.workId = workId;
    this.signature = signature;
    this.desired = desired;

    const pending: string[] = [];
    for (const [sourceKey, source] of desired) {
      if (this.resolve(source)) {
        this.items.set(sourceKey, { sourceKey, source, status: "ready" });
        continue;
      }
      const previous = this.items.get(sourceKey);
      if (previous?.status === "error") continue;
      if (!workId) {
        this.items.set(sourceKey, { sourceKey, source, status: "unavailable" });
        continue;
      }
      this.items.set(sourceKey, { sourceKey, source, status: "loading" });
      pending.push(sourceKey);
    }
    this.emit();
    this.start(pending);
  }

  retry(): void {
    if (this.disposed || !this.workId) return;
    this.abortRun();
    const pending: string[] = [];
    for (const [sourceKey, source] of this.desired) {
      if (this.resolve(source)) {
        this.items.set(sourceKey, { sourceKey, source, status: "ready" });
      } else {
        this.items.set(sourceKey, { sourceKey, source, status: "loading" });
        pending.push(sourceKey);
      }
    }
    this.emit();
    this.start(pending);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortRun();
    this.reset();
    this.desired.clear();
    this.items.clear();
    this.listeners.clear();
  }

  private abortRun(): void {
    this.generation += 1;
    this.run?.controller.abort(
      new DOMException("R8 브러시 질감 하이드레이션 범위가 변경되었습니다.", "AbortError"),
    );
    this.run = null;
  }

  private start(sourceKeys: readonly string[]): void {
    if (!this.workId || sourceKeys.length === 0 || this.disposed) return;
    const generation = ++this.generation;
    const controller = new AbortController();
    const run = { generation, controller };
    this.run = run;
    let cursor = 0;
    const worker = async () => {
      while (cursor < sourceKeys.length) {
        const sourceKey = sourceKeys[cursor++]!;
        await this.hydrateOne(sourceKey, run);
      }
    };
    const workerCount = Math.min(this.maximumConcurrent, sourceKeys.length);
    void Promise.all(Array.from({ length: workerCount }, () => worker()))
      .finally(() => {
        if (this.run === run) this.run = null;
      });
  }

  private isCurrent(run: StudioBrushR8GrainHydrationRun): boolean {
    return (
      !this.disposed
      && !run.controller.signal.aborted
      && this.run === run
      && run.generation === this.generation
    );
  }

  private async hydrateOne(
    sourceKey: string,
    run: StudioBrushR8GrainHydrationRun,
  ): Promise<void> {
    const source = this.desired.get(sourceKey);
    const workId = this.workId;
    if (!source || !workId || !this.isCurrent(run)) return;
    let stage: StudioBrushR8GrainHydrationErrorCode = "request";
    let encodedBytes: Uint8Array | null = null;
    let decodedBytes: Uint8Array | null = null;
    try {
      const downloaded = await this.download(
        workId,
        { assetId: source.asset.assetId, elementType: "image" },
        run.controller.signal,
      );
      if (!this.isCurrent(run)) return;
      stage = "asset-contract";
      encodedBytes = await verifiedEncodedBytes(
        source,
        downloaded,
        run.controller.signal,
      );
      if (!this.isCurrent(run)) return;
      stage = "decode";
      decodedBytes = await decodeStudioBrushR8GrainPng(
        source,
        encodedBytes,
        this.decodePng,
      );
      if (!this.isCurrent(run)) return;
      stage = "registry";
      const result = this.hydrate(source, decodedBytes);
      if (result.status !== "ready") {
        throw new Error(`R8 질감 레지스트리가 에셋을 거부했습니다: ${result.reason}`);
      }
      if (!this.isCurrent(run)) return;
      this.items.set(sourceKey, { sourceKey, source, status: "ready" });
      this.emit();
    } catch (cause) {
      if (!this.isCurrent(run) || run.controller.signal.aborted || abortError(cause)) return;
      const code = stage === "asset-contract"
        && cause instanceof Error
        && cause.message.includes("무결성")
        ? "encoded-integrity"
        : stage;
      const error = hydrationError(sourceKey, source, code, cause);
      this.items.set(sourceKey, { sourceKey, source, status: "error", error });
      this.emit();
    } finally {
      encodedBytes?.fill(0);
      decodedBytes?.fill(0);
    }
  }

  private emit(): void {
    let pending = 0;
    let ready = 0;
    let unavailable = 0;
    const errors: Readonly<StudioBrushR8GrainHydrationErrorState>[] = [];
    for (const item of this.items.values()) {
      if (!this.desired.has(item.sourceKey)) continue;
      if (item.status === "loading") pending += 1;
      else if (item.status === "ready") ready += 1;
      else if (item.status === "unavailable") unavailable += 1;
      else if (item.error) errors.push(item.error);
    }
    this.version = this.version >= Number.MAX_SAFE_INTEGER ? 1 : this.version + 1;
    this.snapshot = Object.freeze({
      version: this.version,
      status: pending > 0
        ? "loading"
        : errors.length > 0
          ? "error"
          : this.desired.size > 0 && unavailable === 0
            ? "ready"
            : "idle",
      observed: this.desired.size,
      pending,
      ready,
      unavailable,
      errors: Object.freeze(errors),
      canRetry: Boolean(this.workId && errors.length > 0),
    });
    for (const listener of this.listeners) listener();
  }
}
