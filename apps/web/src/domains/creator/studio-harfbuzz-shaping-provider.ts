import {
  STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION,
  type StudioLoadedSpecialistProvider,
  type StudioSpecialistProviderDescriptor,
} from "./render/studio-wasm-provider-registry";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_HARFBUZZ_SHAPING_PROVIDER_REVISION = 1 as const;

export const STUDIO_HARFBUZZ_SHAPING_BUDGETS = Object.freeze({
  maxFontBytes: 32 * 1024 * 1024,
  maxTextCodeUnits: 65_536,
  maxGlyphs: 131_072,
  maxFeatures: 64,
  maxLanguageCodeUnits: 63,
  maxFaceIndex: 255,
  maxScale: 1_000_000,
  maxAbsGlyphMetric: 0x7fff_ffff,
  maxConcurrentShapes: 2,
} as const);

export const STUDIO_HARFBUZZ_SHAPING_PROVIDER_DESCRIPTOR = Object.freeze({
  registryRevision: STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION,
  id: "harfbuzz-wasm",
  label: "HarfBuzz OpenType shaping",
  version: STUDIO_HARFBUZZ_SHAPING_PROVIDER_REVISION,
  priority: 100,
  implementation: "wasm-library",
  locality: "main-or-worker",
  initialization: "lazy",
  lifecycle: "explicit-destroy",
  capabilities: Object.freeze(["text:opentype-shaping"]),
  runtimeDependencies: Object.freeze(["harfbuzzjs"]),
  renderer: Object.freeze({
    affinity: "none",
    ownsSurface: false,
  }),
  canonicalBoundary: Object.freeze({
    structuredCloneInput: true,
    structuredCloneOutput: true,
    opaqueRuntimeHandles: "forbidden",
  }),
} as const satisfies StudioSpecialistProviderDescriptor);

export type StudioHarfBuzzDirection = "ltr" | "rtl" | "ttb" | "btt";

export interface StudioHarfBuzzFeature {
  readonly tag: string;
  readonly value: number;
  readonly start?: number;
  readonly end?: number;
}

export interface StudioHarfBuzzShapeRequest {
  readonly fontBytes: ArrayBuffer | ArrayBufferView;
  readonly text: string;
  readonly faceIndex?: number;
  readonly direction: StudioHarfBuzzDirection;
  /** Four-character ISO 15924/OpenType script tag, for example `Hang`. */
  readonly script: string;
  /** BCP 47-style language metadata forwarded to HarfBuzz. */
  readonly language: string;
  readonly features?: readonly StudioHarfBuzzFeature[];
  /** HarfBuzz position scale in font units. Defaults to the face UPEM. */
  readonly xScale?: number;
  /** HarfBuzz position scale in font units. Defaults to the face UPEM. */
  readonly yScale?: number;
}

export interface StudioHarfBuzzGlyph {
  readonly glyphId: number;
  readonly cluster: number;
  readonly xAdvance: number;
  readonly yAdvance: number;
  readonly xOffset: number;
  readonly yOffset: number;
  readonly flags: number;
}

export interface StudioHarfBuzzShapeReceipt {
  readonly kind: "studio-harfbuzz-shape-receipt";
  readonly revision: typeof STUDIO_HARFBUZZ_SHAPING_PROVIDER_REVISION;
  readonly providerId: typeof STUDIO_HARFBUZZ_SHAPING_PROVIDER_DESCRIPTOR.id;
  readonly runtimeVersion: string;
  readonly requestHash: `sha256:${string}`;
  readonly fontHash: `sha256:${string}`;
  readonly textHash: `sha256:${string}`;
  readonly glyphHash: `sha256:${string}`;
  readonly fontByteLength: number;
  readonly textCodeUnits: number;
  readonly faceIndex: number;
  readonly unitsPerEm: number;
  readonly xScale: number;
  readonly yScale: number;
  readonly direction: StudioHarfBuzzDirection;
  readonly script: string;
  readonly language: string;
  readonly features: readonly Readonly<Required<StudioHarfBuzzFeature>>[];
  readonly glyphs: readonly StudioHarfBuzzGlyph[];
  readonly totals: {
    readonly xAdvance: number;
    readonly yAdvance: number;
  };
}

export interface StudioHarfBuzzRuntimeGlyph {
  readonly codepoint: number;
  readonly cluster: number;
  readonly xAdvance?: number;
  readonly yAdvance?: number;
  readonly xOffset?: number;
  readonly yOffset?: number;
  readonly flags?: number;
}

/**
 * Injectable ownership boundary. Handles are intentionally `unknown`: only the
 * adapter that created one may consume or destroy it.
 */
export interface StudioHarfBuzzRuntime {
  readonly version: string;
  createBlob(fontBytes: ArrayBuffer): unknown;
  destroyBlob(blob: unknown): void;
  createFace(blob: unknown, faceIndex: number): unknown;
  destroyFace(face: unknown): void;
  getUnitsPerEm(face: unknown): number;
  createFont(face: unknown): unknown;
  destroyFont(font: unknown): void;
  setFontScale(font: unknown, xScale: number, yScale: number): void;
  createBuffer(): unknown;
  destroyBuffer(buffer: unknown): void;
  addText(buffer: unknown, text: string): void;
  setDirection(buffer: unknown, direction: StudioHarfBuzzDirection): void;
  setScript(buffer: unknown, script: string): void;
  setLanguage(buffer: unknown, language: string): void;
  setMonotoneGraphemeClusters(buffer: unknown): void;
  shape(
    font: unknown,
    buffer: unknown,
    features: readonly Readonly<Required<StudioHarfBuzzFeature>>[],
  ): void;
  getGlyphs(buffer: unknown): readonly StudioHarfBuzzRuntimeGlyph[];
  destroy(): Promise<void> | void;
}

export type StudioHarfBuzzRuntimeLoader =
  () => Promise<StudioHarfBuzzRuntime> | StudioHarfBuzzRuntime;

export class StudioHarfBuzzProviderError extends Error {
  constructor(
    readonly code:
      | "invalid-request"
      | "budget-exceeded"
      | "backpressure"
      | "runtime-failed"
      | "invalid-runtime-output"
      | "disposed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioHarfBuzzProviderError";
  }
}

export interface StudioHarfBuzzShapingProvider
  extends StudioLoadedSpecialistProvider {
  readonly descriptor:
    typeof STUDIO_HARFBUZZ_SHAPING_PROVIDER_DESCRIPTOR;
  shape(request: StudioHarfBuzzShapeRequest): Promise<StudioHarfBuzzShapeReceipt>;
  snapshot(): Readonly<{
    state: "ready" | "destroying" | "destroyed";
    runtimeLoaded: boolean;
    activeShapes: number;
  }>;
}

interface PreparedShapeRequest {
  readonly fontBytes: Uint8Array<ArrayBuffer>;
  readonly text: string;
  readonly faceIndex: number;
  readonly direction: StudioHarfBuzzDirection;
  readonly script: string;
  readonly language: string;
  readonly features: readonly Readonly<Required<StudioHarfBuzzFeature>>[];
  readonly requestedXScale: number | null;
  readonly requestedYScale: number | null;
}

const DIRECTIONS = new Set<StudioHarfBuzzDirection>([
  "ltr",
  "rtl",
  "ttb",
  "btt",
]);
const SCRIPT_PATTERN = /^[A-Za-z]{4}$/u;
const LANGUAGE_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;
const FEATURE_TAG_PATTERN = /^[\x20-\x7e]{4}$/u;

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function digestText(value: string): `sha256:${string}` {
  return digest(new TextEncoder().encode(value));
}

function invalid(message: string): never {
  throw new StudioHarfBuzzProviderError("invalid-request", message);
}

function budget(message: string): never {
  throw new StudioHarfBuzzProviderError("budget-exceeded", message);
}

function copyFontBytes(
  source: ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> {
  let sourceView: Uint8Array;
  if (source instanceof ArrayBuffer) {
    sourceView = new Uint8Array(source);
  } else if (ArrayBuffer.isView(source)) {
    sourceView = new Uint8Array(
      source.buffer,
      source.byteOffset,
      source.byteLength,
    );
  } else {
    invalid("fontBytes must be an ArrayBuffer or ArrayBuffer view.");
  }
  if (sourceView.byteLength === 0) invalid("fontBytes must not be empty.");
  if (sourceView.byteLength > STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxFontBytes) {
    budget("Font byte budget exceeded.");
  }
  return Uint8Array.from(sourceView);
}

function ownDataValue(
  source: object,
  key: string,
  required = false,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor) {
    if (required) invalid(`${key} must be an own data property.`);
    return undefined;
  }
  if (!("value" in descriptor)) {
    invalid(`${key} must not be an accessor property.`);
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

function preflightFontBytes(source: unknown): asserts source is
ArrayBuffer | ArrayBufferView {
  if (!(source instanceof ArrayBuffer) && !ArrayBuffer.isView(source)) {
    invalid("fontBytes must be an ArrayBuffer or ArrayBuffer view.");
  }
  if (source.byteLength === 0) invalid("fontBytes must not be empty.");
  if (source.byteLength > STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxFontBytes) {
    budget("Font byte budget exceeded.");
  }
}

function prepareRequest(
  request: StudioHarfBuzzShapeRequest,
): PreparedShapeRequest {
  if (!request || typeof request !== "object") {
    invalid("Shape request must be an object.");
  }
  const fontBytes = ownDataValue(request, "fontBytes", true);
  const text = ownDataValue(request, "text", true);
  const faceIndexValue = ownDataValue(request, "faceIndex");
  const direction = ownDataValue(request, "direction", true);
  const script = ownDataValue(request, "script", true);
  const language = ownDataValue(request, "language", true);
  const featureValue = ownDataValue(request, "features");
  const xScaleValue = ownDataValue(request, "xScale");
  const yScaleValue = ownDataValue(request, "yScale");
  preflightFontBytes(fontBytes);
  if (typeof text !== "string") invalid("text must be a string.");
  if (
    text.length > STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxTextCodeUnits
  ) {
    budget("Text code-unit budget exceeded.");
  }
  if (!DIRECTIONS.has(direction as StudioHarfBuzzDirection)) {
    invalid("direction must be ltr, rtl, ttb, or btt.");
  }
  if (
    typeof script !== "string"
    || !SCRIPT_PATTERN.test(script)
  ) {
    invalid("script must be a four-letter script tag.");
  }
  if (
    typeof language !== "string"
    || language.length === 0
    || language.length
      > STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxLanguageCodeUnits
    || !LANGUAGE_PATTERN.test(language)
  ) {
    invalid("language must be a bounded BCP 47-style tag.");
  }

  const faceIndex = faceIndexValue ?? 0;
  if (
    typeof faceIndex !== "number"
    || !Number.isSafeInteger(faceIndex)
    || faceIndex < 0
    || faceIndex > STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxFaceIndex
  ) {
    invalid("faceIndex is outside the supported range.");
  }
  for (const [label, value] of [
    ["xScale", xScaleValue],
    ["yScale", yScaleValue],
  ] as const) {
    if (
      value !== undefined
      && (
        typeof value !== "number"
        || !Number.isSafeInteger(value)
        || value <= 0
        || value > STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxScale
      )
    ) {
      invalid(`${label} must be a positive bounded integer.`);
    }
  }

  const sourceFeatures = featureValue ?? [];
  if (!Array.isArray(sourceFeatures)) invalid("features must be an array.");
  if (sourceFeatures.length > STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxFeatures) {
    budget("OpenType feature budget exceeded.");
  }
  const features = ownArrayValues(sourceFeatures, "features").map((feature, index) => {
    if (!feature || typeof feature !== "object") {
      invalid(`features[${index}] must be an object.`);
    }
    const tag = ownDataValue(feature, "tag", true);
    const value = ownDataValue(feature, "value", true);
    const startValue = ownDataValue(feature, "start");
    const endValue = ownDataValue(feature, "end");
    if (
      typeof tag !== "string"
      || !FEATURE_TAG_PATTERN.test(tag)
    ) {
      invalid(`features[${index}].tag must contain four printable ASCII characters.`);
    }
    if (
      !Number.isSafeInteger(value)
      || typeof value !== "number"
      || value < 0
      || value > 0xffff_ffff
    ) {
      invalid(`features[${index}].value is outside the supported range.`);
    }
    const start = startValue ?? 0;
    const end = endValue ?? 0xffff_ffff;
    if (
      typeof start !== "number"
      || typeof end !== "number"
      || !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || start < 0
      || end < start
      || end > 0xffff_ffff
    ) {
      invalid(`features[${index}] has an invalid cluster range.`);
    }
    return Object.freeze({
      tag,
      value,
      start,
      end,
    });
  });

  return {
    fontBytes: copyFontBytes(fontBytes),
    text,
    faceIndex: faceIndex as number,
    direction: direction as StudioHarfBuzzDirection,
    script,
    language,
    features: Object.freeze(features),
    requestedXScale: (xScaleValue as number | undefined) ?? null,
    requestedYScale: (yScaleValue as number | undefined) ?? null,
  };
}

function finiteBoundedMetric(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isFinite(value)
    && Math.abs(value)
      <= STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxAbsGlyphMetric
  );
}

function projectGlyphs(
  glyphValues: readonly StudioHarfBuzzRuntimeGlyph[],
  textCodeUnits: number,
): readonly StudioHarfBuzzGlyph[] {
  if (!Array.isArray(glyphValues)) {
    throw new StudioHarfBuzzProviderError(
      "invalid-runtime-output",
      "HarfBuzz runtime returned a non-array glyph result.",
    );
  }
  if (glyphValues.length > STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxGlyphs) {
    throw new StudioHarfBuzzProviderError(
      "budget-exceeded",
      "HarfBuzz glyph output budget exceeded.",
    );
  }
  return Object.freeze(glyphValues.map((glyph, index) => {
    const xAdvance = glyph.xAdvance ?? 0;
    const yAdvance = glyph.yAdvance ?? 0;
    const xOffset = glyph.xOffset ?? 0;
    const yOffset = glyph.yOffset ?? 0;
    const flags = glyph.flags ?? 0;
    if (
      !glyph
      || !Number.isSafeInteger(glyph.codepoint)
      || glyph.codepoint < 0
      || glyph.codepoint > 0xffff_ffff
      || !Number.isSafeInteger(glyph.cluster)
      || glyph.cluster < 0
      || glyph.cluster > textCodeUnits
      || !finiteBoundedMetric(xAdvance)
      || !finiteBoundedMetric(yAdvance)
      || !finiteBoundedMetric(xOffset)
      || !finiteBoundedMetric(yOffset)
      || !Number.isSafeInteger(flags)
      || flags < 0
      || flags > 0xffff_ffff
    ) {
      throw new StudioHarfBuzzProviderError(
        "invalid-runtime-output",
        `HarfBuzz runtime returned an invalid glyph at index ${index}.`,
      );
    }
    return Object.freeze({
      glyphId: glyph.codepoint,
      cluster: glyph.cluster,
      xAdvance,
      yAdvance,
      xOffset,
      yOffset,
      flags,
    });
  }));
}

function safeDestroy(
  destroy: (handle: unknown) => void,
  handle: unknown,
): void {
  try {
    destroy(handle);
  } catch {
    // Teardown continues in reverse creation order. A cleanup failure must not
    // leak the remaining resources or replace an operation error.
  }
}

function createReceipt(
  runtime: StudioHarfBuzzRuntime,
  request: PreparedShapeRequest,
  unitsPerEm: number,
  xScale: number,
  yScale: number,
  glyphs: readonly StudioHarfBuzzGlyph[],
): StudioHarfBuzzShapeReceipt {
  const fontHash = digest(request.fontBytes);
  const textHash = digestText(request.text);
  const canonicalRequest = JSON.stringify({
    fontHash,
    textHash,
    faceIndex: request.faceIndex,
    direction: request.direction,
    script: request.script,
    language: request.language,
    features: request.features,
    xScale,
    yScale,
  });
  const glyphHash = digestText(JSON.stringify(glyphs));
  return {
    kind: "studio-harfbuzz-shape-receipt",
    revision: STUDIO_HARFBUZZ_SHAPING_PROVIDER_REVISION,
    providerId: STUDIO_HARFBUZZ_SHAPING_PROVIDER_DESCRIPTOR.id,
    runtimeVersion: runtime.version,
    requestHash: digestText(canonicalRequest),
    fontHash,
    textHash,
    glyphHash,
    fontByteLength: request.fontBytes.byteLength,
    textCodeUnits: request.text.length,
    faceIndex: request.faceIndex,
    unitsPerEm,
    xScale,
    yScale,
    direction: request.direction,
    script: request.script,
    language: request.language,
    features: request.features.map((feature) => ({ ...feature })),
    glyphs: glyphs.map((glyph) => ({ ...glyph })),
    totals: {
      xAdvance: glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0),
      yAdvance: glyphs.reduce((sum, glyph) => sum + glyph.yAdvance, 0),
    },
  };
}

function executeShape(
  runtime: StudioHarfBuzzRuntime,
  request: PreparedShapeRequest,
): StudioHarfBuzzShapeReceipt {
  let blob: unknown;
  let face: unknown;
  let font: unknown;
  let buffer: unknown;
  let hasBlob = false;
  let hasFace = false;
  let hasFont = false;
  let hasBuffer = false;
  try {
    blob = runtime.createBlob(request.fontBytes.buffer);
    hasBlob = true;
    face = runtime.createFace(blob, request.faceIndex);
    hasFace = true;
    const unitsPerEm = runtime.getUnitsPerEm(face);
    if (
      !Number.isSafeInteger(unitsPerEm)
      || unitsPerEm <= 0
      || unitsPerEm > STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxScale
    ) {
      throw new StudioHarfBuzzProviderError(
        "invalid-runtime-output",
        "HarfBuzz runtime returned an invalid units-per-em value.",
      );
    }
    const xScale = request.requestedXScale ?? unitsPerEm;
    const yScale = request.requestedYScale ?? unitsPerEm;
    font = runtime.createFont(face);
    hasFont = true;
    runtime.setFontScale(font, xScale, yScale);
    buffer = runtime.createBuffer();
    hasBuffer = true;
    runtime.addText(buffer, request.text);
    runtime.setMonotoneGraphemeClusters(buffer);
    runtime.setDirection(buffer, request.direction);
    runtime.setScript(buffer, request.script);
    runtime.setLanguage(buffer, request.language);
    runtime.shape(font, buffer, request.features);
    const glyphs = projectGlyphs(
      runtime.getGlyphs(buffer),
      request.text.length,
    );
    return createReceipt(
      runtime,
      request,
      unitsPerEm,
      xScale,
      yScale,
      glyphs,
    );
  } finally {
    if (hasBuffer) safeDestroy(runtime.destroyBuffer.bind(runtime), buffer);
    if (hasFont) safeDestroy(runtime.destroyFont.bind(runtime), font);
    if (hasFace) safeDestroy(runtime.destroyFace.bind(runtime), face);
    if (hasBlob) safeDestroy(runtime.destroyBlob.bind(runtime), blob);
  }
}

function asProviderError(error: unknown): StudioHarfBuzzProviderError {
  if (error instanceof StudioHarfBuzzProviderError) return error;
  return new StudioHarfBuzzProviderError(
    "runtime-failed",
    "HarfBuzz shaping runtime failed.",
    { cause: error },
  );
}

export function createStudioHarfBuzzShapingProvider(
  options: Readonly<{
    runtimeLoader?: StudioHarfBuzzRuntimeLoader;
    maxConcurrentShapes?: number;
  }> = {},
): StudioHarfBuzzShapingProvider {
  const runtimeLoader = options.runtimeLoader ?? loadStudioHarfBuzzRuntime;
  const maxConcurrentShapes =
    options.maxConcurrentShapes
    ?? STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxConcurrentShapes;
  if (
    !Number.isSafeInteger(maxConcurrentShapes)
    || maxConcurrentShapes < 1
    || maxConcurrentShapes
      > STUDIO_HARFBUZZ_SHAPING_BUDGETS.maxConcurrentShapes
  ) {
    throw new RangeError("Invalid HarfBuzz concurrent shape budget.");
  }

  let state: "ready" | "destroying" | "destroyed" = "ready";
  let runtimePromise: Promise<StudioHarfBuzzRuntime> | null = null;
  let runtime: StudioHarfBuzzRuntime | null = null;
  let activeShapes = 0;
  let resolveIdle: (() => void) | null = null;
  let destroyPromise: Promise<void> | null = null;

  const loadRuntime = (): Promise<StudioHarfBuzzRuntime> => {
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

  const provider: StudioHarfBuzzShapingProvider = {
    descriptor: STUDIO_HARFBUZZ_SHAPING_PROVIDER_DESCRIPTOR,

    async shape(request) {
      if (state !== "ready") {
        throw new StudioHarfBuzzProviderError(
          "disposed",
          "HarfBuzz shaping provider is not ready.",
        );
      }
      if (activeShapes >= maxConcurrentShapes) {
        throw new StudioHarfBuzzProviderError(
          "backpressure",
          "HarfBuzz concurrent shape budget exceeded.",
        );
      }
      const prepared = prepareRequest(request);
      activeShapes += 1;
      try {
        const loaded = await loadRuntime();
        if (state !== "ready") {
          throw new StudioHarfBuzzProviderError(
            "disposed",
            "HarfBuzz shaping provider was destroyed during initialization.",
          );
        }
        return executeShape(loaded, prepared);
      } catch (error) {
        throw asProviderError(error);
      } finally {
        activeShapes -= 1;
        if (activeShapes === 0) {
          resolveIdle?.();
          resolveIdle = null;
        }
      }
    },

    snapshot() {
      return {
        state,
        runtimeLoaded: runtime !== null,
        activeShapes,
      };
    },

    destroy() {
      if (destroyPromise) return destroyPromise;
      state = "destroying";
      destroyPromise = (async () => {
        if (activeShapes > 0) {
          await new Promise<void>((resolve) => {
            resolveIdle = resolve;
          });
        }
        const loaded = runtime;
        if (loaded) await loaded.destroy();
        runtime = null;
        runtimePromise = null;
        state = "destroyed";
      })();
      return destroyPromise;
    },
  };
  return provider;
}

type HarfBuzzJsModule = typeof import("harfbuzzjs");

interface DisposableUpstreamHandle {
  destroy?: () => void;
  free?: () => void;
  reset?: () => void;
}

function releaseUpstreamHandle(
  value: unknown,
  resetBeforeRelease = false,
): void {
  if (!value || typeof value !== "object") return;
  const handle = value as DisposableUpstreamHandle;
  if (resetBeforeRelease) handle.reset?.();
  if (typeof handle.free === "function") {
    handle.free();
    return;
  }
  handle.destroy?.();
}

function createHarfBuzzJsRuntime(
  hb: HarfBuzzJsModule,
): StudioHarfBuzzRuntime {
  const directions = {
    ltr: hb.Direction.LTR,
    rtl: hb.Direction.RTL,
    ttb: hb.Direction.TTB,
    btt: hb.Direction.BTT,
  } as const;
  return {
    version: hb.versionString(),
    createBlob(fontBytes) {
      return new hb.Blob(fontBytes);
    },
    destroyBlob(blob) {
      releaseUpstreamHandle(blob);
    },
    createFace(blob, faceIndex) {
      return new hb.Face(blob as InstanceType<typeof hb.Blob>, faceIndex);
    },
    destroyFace(face) {
      releaseUpstreamHandle(face);
    },
    getUnitsPerEm(face) {
      return (face as InstanceType<typeof hb.Face>).upem;
    },
    createFont(face) {
      return new hb.Font(face as InstanceType<typeof hb.Face>);
    },
    destroyFont(font) {
      releaseUpstreamHandle(font);
    },
    setFontScale(font, xScale, yScale) {
      (font as InstanceType<typeof hb.Font>).setScale(xScale, yScale);
    },
    createBuffer() {
      return new hb.Buffer();
    },
    destroyBuffer(buffer) {
      releaseUpstreamHandle(buffer, true);
    },
    addText(buffer, text) {
      (buffer as InstanceType<typeof hb.Buffer>).addText(text);
    },
    setDirection(buffer, direction) {
      (buffer as InstanceType<typeof hb.Buffer>)
        .setDirection(directions[direction]);
    },
    setScript(buffer, script) {
      (buffer as InstanceType<typeof hb.Buffer>).setScript(script);
    },
    setLanguage(buffer, language) {
      (buffer as InstanceType<typeof hb.Buffer>).setLanguage(language);
    },
    setMonotoneGraphemeClusters(buffer) {
      (buffer as InstanceType<typeof hb.Buffer>)
        .setClusterLevel(hb.ClusterLevel.MONOTONE_GRAPHEMES);
    },
    shape(font, buffer, features) {
      hb.shape(
        font as InstanceType<typeof hb.Font>,
        buffer as InstanceType<typeof hb.Buffer>,
        features.map(
          (feature) =>
            new hb.Feature(
              feature.tag,
              feature.value,
              feature.start,
              feature.end,
            ),
        ),
      );
    },
    getGlyphs(buffer) {
      return (buffer as InstanceType<typeof hb.Buffer>)
        .getGlyphInfosAndPositions()
        .map((glyph) => ({ ...glyph }));
    },
    destroy() {
      // harfbuzzjs owns one package-global module instance. Per-operation
      // handles have already crossed the explicit adapter teardown boundary.
    },
  };
}

/** Loads the package only when the first valid shape request is admitted. */
export async function loadStudioHarfBuzzRuntime(): Promise<StudioHarfBuzzRuntime> {
  const hb = await import("harfbuzzjs");
  return createHarfBuzzJsRuntime(hb);
}
