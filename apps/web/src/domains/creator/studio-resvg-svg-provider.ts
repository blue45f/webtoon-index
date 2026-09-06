import {
  STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION,
  type StudioLoadedSpecialistProvider,
  type StudioSpecialistProviderDescriptor,
} from "./render/studio-wasm-provider-registry";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_RESVG_PROVIDER_REVISION = 1 as const;

export const STUDIO_RESVG_BUDGETS = Object.freeze({
  maxSvgCodeUnits: 2 * 1024 * 1024,
  maxDimensionPx: 16_384,
  maxPixels: 16_777_216,
  maxRgbaBytes: 67_108_864,
  maxPngBytes: 67_108_864,
  maxFontCount: 16,
  maxFontBytes: 32 * 1024 * 1024,
  maxFontFamilyCodeUnits: 128,
  maxLanguages: 16,
  maxLanguageCodeUnits: 63,
  maxConcurrentRenders: 2,
} as const);

export const STUDIO_RESVG_PROVIDER_DESCRIPTOR = Object.freeze({
  registryRevision: STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION,
  id: "resvg-wasm",
  label: "resvg SVG rasterization",
  version: STUDIO_RESVG_PROVIDER_REVISION,
  priority: 90,
  implementation: "wasm-library",
  locality: "main-or-worker",
  initialization: "lazy",
  lifecycle: "explicit-destroy",
  capabilities: Object.freeze([
    "vector:svg-raster-rgba",
    "vector:svg-raster-png",
  ]),
  runtimeDependencies: Object.freeze(["resvg-wasm"]),
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

export type StudioResvgFit =
  | Readonly<{ mode: "original" }>
  | Readonly<{ mode: "width"; value: number }>
  | Readonly<{ mode: "height"; value: number }>
  | Readonly<{ mode: "zoom"; value: number }>;

export type StudioResvgImagePolicy = "deny" | "embedded-raster-data";

export interface StudioResvgFontPolicy {
  readonly mode: "none" | "custom-only";
  readonly fontBuffers?: readonly (ArrayBuffer | ArrayBufferView)[];
  readonly defaultFontFamily?: string;
}

export interface StudioResvgRenderRequest {
  readonly svg: string;
  readonly fit?: StudioResvgFit;
  readonly fontPolicy: StudioResvgFontPolicy;
  readonly imagePolicy: StudioResvgImagePolicy;
  readonly languages?: readonly string[];
  readonly background?: string;
}

export interface StudioResvgRuntimeOptions {
  readonly fit: StudioResvgFit;
  readonly fontBuffers: readonly Uint8Array<ArrayBuffer>[];
  readonly defaultFontFamily: string | null;
  readonly languages: readonly string[];
  readonly background: string | null;
  readonly loadSystemFonts: false;
  readonly loadFontFiles: false;
  readonly resolveExternalImages: false;
  readonly shapeRendering: "geometric-precision";
  readonly textRendering: "optimize-legibility";
  readonly imageRendering: "optimize-quality";
}

export interface StudioResvgRuntime {
  readonly version: string;
  createRenderer(svg: string, options: StudioResvgRuntimeOptions): unknown;
  destroyRenderer(renderer: unknown): void;
  rendererDimensions(renderer: unknown): Readonly<{
    width: number;
    height: number;
  }>;
  unresolvedImages(renderer: unknown): readonly string[];
  render(renderer: unknown): unknown;
  destroyRenderedImage(image: unknown): void;
  renderedDimensions(image: unknown): Readonly<{
    width: number;
    height: number;
  }>;
  rgba(image: unknown): Uint8Array;
  png(image: unknown): Uint8Array;
  destroy(): Promise<void> | void;
}

export type StudioResvgRuntimeLoader =
  () => Promise<StudioResvgRuntime> | StudioResvgRuntime;

export interface StudioResvgRenderReceipt {
  readonly kind: "studio-resvg-render-receipt";
  readonly revision: typeof STUDIO_RESVG_PROVIDER_REVISION;
  readonly providerId: typeof STUDIO_RESVG_PROVIDER_DESCRIPTOR.id;
  readonly runtimeVersion: string;
  readonly requestHash: `sha256:${string}`;
  readonly sanitizedSvgHash: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly fit: StudioResvgFit;
  readonly policies: {
    readonly fonts: "none" | "custom-only";
    readonly images: StudioResvgImagePolicy;
    readonly systemFonts: false;
    readonly fontFiles: false;
    readonly externalImages: false;
  };
  readonly fonts: readonly Readonly<{
    byteLength: number;
    hash: `sha256:${string}`;
  }>[];
  readonly rgba: {
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly byteLength: number;
    readonly hash: `sha256:${string}`;
  };
  readonly png: {
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly byteLength: number;
    readonly hash: `sha256:${string}`;
  };
  readonly receiptHash: `sha256:${string}`;
}

export class StudioResvgProviderError extends Error {
  constructor(
    readonly code:
      | "invalid-request"
      | "unsafe-svg"
      | "budget-exceeded"
      | "backpressure"
      | "runtime-failed"
      | "invalid-runtime-output"
      | "disposed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioResvgProviderError";
  }
}

export interface StudioResvgSvgProvider extends StudioLoadedSpecialistProvider {
  readonly descriptor: typeof STUDIO_RESVG_PROVIDER_DESCRIPTOR;
  render(request: StudioResvgRenderRequest): Promise<StudioResvgRenderReceipt>;
  snapshot(): Readonly<{
    state: "ready" | "destroying" | "destroyed";
    runtimeLoaded: boolean;
    activeRenders: number;
  }>;
}

interface PreparedRenderRequest {
  readonly svg: string;
  readonly fit: StudioResvgFit;
  readonly fontMode: StudioResvgFontPolicy["mode"];
  readonly fontBuffers: readonly Uint8Array<ArrayBuffer>[];
  readonly defaultFontFamily: string | null;
  readonly imagePolicy: StudioResvgImagePolicy;
  readonly languages: readonly string[];
  readonly background: string | null;
}

const LANGUAGE_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;
const BACKGROUND_PATTERN =
  /^(?:transparent|#[0-9a-f]{3,8}|rgba?\([0-9.,%+\-\s]+\)|hsla?\([0-9.,%+\-\s]+\))$/iu;
const FORBIDDEN_ELEMENT_PATTERN =
  /<\s*\/?\s*(?:script|foreignObject|iframe|object|embed|audio|video|canvas|frame|frameset|portal)\b/iu;
const EVENT_ATTRIBUTE_PATTERN = /\bon[a-z0-9_-]+\s*=/iu;
const HREF_ATTRIBUTE_PATTERN =
  /\b(?:href|xlink:href)\s*=\s*(["'])([\s\S]*?)\1/giu;
const ANY_HREF_ATTRIBUTE_PATTERN = /\b(?:href|xlink:href)\s*=/giu;
const URL_FUNCTION_PATTERN =
  /url\(\s*(["']?)([\s\S]*?)\1\s*\)/giu;
const IMAGE_ELEMENT_PATTERN = /<\s*(?:image|feImage)\b[\s\S]*?>/giu;
const DATA_RASTER_IMAGE_PATTERN =
  /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/iu;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function digestText(value: string): `sha256:${string}` {
  return digest(new TextEncoder().encode(value));
}

function invalid(message: string): never {
  throw new StudioResvgProviderError("invalid-request", message);
}

function unsafe(message: string): never {
  throw new StudioResvgProviderError("unsafe-svg", message);
}

function budget(message: string): never {
  throw new StudioResvgProviderError("budget-exceeded", message);
}

function decodeXmlReferences(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|amp|lt|gt|quot|apos);/giu,
    (entity, hexadecimal: string | undefined, decimal: string | undefined) => {
      const lower = String(entity).toLowerCase();
      if (lower === "&amp;") return "&";
      if (lower === "&lt;") return "<";
      if (lower === "&gt;") return ">";
      if (lower === "&quot;") return '"';
      if (lower === "&apos;") return "'";
      const codePoint = Number.parseInt(hexadecimal ?? decimal ?? "", hexadecimal ? 16 : 10);
      if (
        !Number.isSafeInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10ffff
      ) {
        unsafe("SVG contains an invalid character reference.");
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

function allowedHref(value: string, imagePolicy: StudioResvgImagePolicy): boolean {
  const decoded = decodeXmlReferences(value).trim();
  if (decoded.startsWith("#")) return decoded.length > 1;
  return (
    imagePolicy === "embedded-raster-data"
    && DATA_RASTER_IMAGE_PATTERN.test(decoded)
  );
}

function hasForbiddenXmlControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit < 0x20
      && codeUnit !== 0x09
      && codeUnit !== 0x0a
      && codeUnit !== 0x0d
    ) {
      return true;
    }
  }
  return false;
}

function hasForbiddenFontFamilyCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0x20 || "\"'<>".includes(value[index] ?? "")) return true;
  }
  return false;
}

function sanitizeSvg(
  value: string,
  imagePolicy: StudioResvgImagePolicy,
): string {
  if (typeof value !== "string") invalid("svg must be a string.");
  if (value.length === 0) invalid("svg must not be empty.");
  if (value.length > STUDIO_RESVG_BUDGETS.maxSvgCodeUnits) {
    budget("SVG source budget exceeded.");
  }
  if (hasForbiddenXmlControl(value)) {
    unsafe("SVG contains forbidden control characters.");
  }
  const normalized = value
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .trim();
  const withoutDeclaration = normalized.replace(
    /^<\?xml\s+[^?]*\?>\s*/iu,
    "",
  );
  if (!/^<svg(?:\s|>)/iu.test(withoutDeclaration)) {
    invalid("SVG source must have an svg document root.");
  }
  if (
    /<!doctype\b|<!entity\b/iu.test(normalized)
    || /<\?(?!xml\b)/iu.test(normalized)
  ) {
    unsafe("SVG declarations and processing instructions are not allowed.");
  }
  if (
    FORBIDDEN_ELEMENT_PATTERN.test(normalized)
    || EVENT_ATTRIBUTE_PATTERN.test(normalized)
    || /\bxml:base\s*=/iu.test(normalized)
    || /(?:javascript|vbscript)\s*:/iu.test(normalized)
    || /@(?:import|font-face|namespace)\b/iu.test(normalized)
    || /(?:expression|-moz-binding)\s*\(/iu.test(normalized)
  ) {
    unsafe("SVG contains active or externally resolved content.");
  }

  const hrefMatches = [...normalized.matchAll(HREF_ATTRIBUTE_PATTERN)];
  const hrefAttributeCount =
    normalized.match(ANY_HREF_ATTRIBUTE_PATTERN)?.length ?? 0;
  if (hrefMatches.length !== hrefAttributeCount) {
    unsafe("SVG href attributes must use quoted values.");
  }
  for (const match of hrefMatches) {
    if (!allowedHref(match[2] ?? "", imagePolicy)) {
      unsafe("SVG contains a disallowed href resource.");
    }
  }
  for (const match of normalized.matchAll(URL_FUNCTION_PATTERN)) {
    const target = decodeXmlReferences(match[2] ?? "").trim();
    if (!target.startsWith("#") || target.length === 1) {
      unsafe("SVG contains a disallowed CSS URL resource.");
    }
  }

  const imageElements = [...normalized.matchAll(IMAGE_ELEMENT_PATTERN)];
  if (imagePolicy === "deny" && imageElements.length > 0) {
    unsafe("SVG image elements are disabled by policy.");
  }
  if (imagePolicy === "embedded-raster-data") {
    for (const match of imageElements) {
      const tag = match[0];
      const href = [...tag.matchAll(HREF_ATTRIBUTE_PATTERN)][0]?.[2];
      if (!href || !allowedHref(href, imagePolicy) || href.trim().startsWith("#")) {
        unsafe("SVG image elements require embedded raster data.");
      }
    }
  }
  return normalized;
}

function copyBytes(
  source: ArrayBuffer | ArrayBufferView,
  label: string,
): Uint8Array<ArrayBuffer> {
  let view: Uint8Array;
  if (source instanceof ArrayBuffer) {
    view = new Uint8Array(source);
  } else if (ArrayBuffer.isView(source)) {
    view = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  } else {
    invalid(`${label} must be an ArrayBuffer or ArrayBuffer view.`);
  }
  if (view.byteLength === 0) invalid(`${label} must not be empty.`);
  return Uint8Array.from(view);
}

function declaredByteLength(
  source: unknown,
  label: string,
): number {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    return source.byteLength;
  }
  invalid(`${label} must be an ArrayBuffer or ArrayBuffer view.`);
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

function prepareFit(fit: StudioResvgFit | undefined): StudioResvgFit {
  if (fit === undefined) return Object.freeze({ mode: "original" });
  if (!fit || typeof fit !== "object") invalid("fit must be an object.");
  const mode = ownDataValue(fit, "mode", true);
  const value = ownDataValue(fit, "value");
  if (mode === "original") return Object.freeze({ mode: "original" });
  if (mode === "width" || mode === "height") {
    if (
      !Number.isSafeInteger(value)
      || typeof value !== "number"
      || value < 1
      || value > STUDIO_RESVG_BUDGETS.maxDimensionPx
    ) {
      invalid(`fit ${mode} must be a bounded positive integer.`);
    }
    return Object.freeze({ mode, value });
  }
  if (mode === "zoom") {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 64) {
      invalid("fit zoom must be a finite value in the range (0, 64].");
    }
    return Object.freeze({ mode: "zoom", value });
  }
  invalid("Unsupported SVG fit mode.");
}

function prepareRequest(
  request: StudioResvgRenderRequest,
): PreparedRenderRequest {
  if (!request || typeof request !== "object") {
    invalid("Render request must be an object.");
  }
  const svg = ownDataValue(request, "svg", true);
  const fit = ownDataValue(request, "fit") as StudioResvgFit | undefined;
  const fontPolicyValue = ownDataValue(request, "fontPolicy", true);
  const imagePolicy = ownDataValue(request, "imagePolicy", true);
  const languageValue = ownDataValue(request, "languages");
  const backgroundValue = ownDataValue(request, "background");
  if (
    imagePolicy !== "deny"
    && imagePolicy !== "embedded-raster-data"
  ) {
    invalid("Unsupported image policy.");
  }
  if (
    !fontPolicyValue
    || typeof fontPolicyValue !== "object"
    || (
      ownDataValue(fontPolicyValue, "mode", true) !== "none"
      && ownDataValue(fontPolicyValue, "mode", true) !== "custom-only"
    )
  ) {
    invalid("An explicit font policy is required.");
  }
  const fontMode = ownDataValue(fontPolicyValue, "mode", true) as
    StudioResvgFontPolicy["mode"];
  const sourceFontsValue = ownDataValue(fontPolicyValue, "fontBuffers");
  const sourceFonts = sourceFontsValue ?? [];
  if (!Array.isArray(sourceFonts)) invalid("fontBuffers must be an array.");
  if (
    fontMode === "none"
    && sourceFonts.length > 0
  ) {
    invalid("Font buffers are forbidden when font policy is none.");
  }
  if (sourceFonts.length > STUDIO_RESVG_BUDGETS.maxFontCount) {
    budget("Custom font count budget exceeded.");
  }
  const sourceFontValues = ownArrayValues(sourceFonts, "fontBuffers");
  let totalFontBytes = 0;
  for (let index = 0; index < sourceFontValues.length; index += 1) {
    const byteLength = declaredByteLength(
      sourceFontValues[index],
      `fontBuffers[${index}]`,
    );
    totalFontBytes += byteLength;
    if (
      !Number.isSafeInteger(totalFontBytes)
      || totalFontBytes > STUDIO_RESVG_BUDGETS.maxFontBytes
    ) {
      budget("Custom font byte budget exceeded.");
    }
  }
  if (totalFontBytes > STUDIO_RESVG_BUDGETS.maxFontBytes) {
    budget("Custom font byte budget exceeded.");
  }
  const fontBuffers = sourceFontValues.map((source, index) =>
    copyBytes(
      source as ArrayBuffer | ArrayBufferView,
      `fontBuffers[${index}]`,
    )
  );
  const defaultFontFamilyValue = ownDataValue(
    fontPolicyValue,
    "defaultFontFamily",
  );
  const defaultFontFamily = defaultFontFamilyValue ?? null;
  if (
    defaultFontFamily !== null
    && (
      typeof defaultFontFamily !== "string"
      || defaultFontFamily.trim().length === 0
      || defaultFontFamily.length
        > STUDIO_RESVG_BUDGETS.maxFontFamilyCodeUnits
      || hasForbiddenFontFamilyCharacter(defaultFontFamily)
    )
  ) {
    invalid("defaultFontFamily is invalid or exceeds its budget.");
  }

  const sourceLanguages = languageValue ?? [];
  if (!Array.isArray(sourceLanguages)) invalid("languages must be an array.");
  if (sourceLanguages.length > STUDIO_RESVG_BUDGETS.maxLanguages) {
    budget("SVG language budget exceeded.");
  }
  const languages = ownArrayValues(sourceLanguages, "languages").map((language, index) => {
    if (
      typeof language !== "string"
      || language.length === 0
      || language.length > STUDIO_RESVG_BUDGETS.maxLanguageCodeUnits
      || !LANGUAGE_PATTERN.test(language)
    ) {
      invalid(`languages[${index}] is not a bounded language tag.`);
    }
    return language;
  });

  const background = backgroundValue ?? null;
  if (
    background !== null
    && (
      typeof background !== "string"
      || background.length > 96
      || !BACKGROUND_PATTERN.test(background.trim())
    )
  ) {
    invalid("background must be a bounded literal color.");
  }
  return {
    svg: sanitizeSvg(svg as string, imagePolicy),
    fit: prepareFit(fit),
    fontMode,
    fontBuffers: Object.freeze(fontBuffers),
    defaultFontFamily: defaultFontFamily?.trim() ?? null,
    imagePolicy,
    languages: Object.freeze(languages),
    background: background?.trim() ?? null,
  };
}

function validDimensions(
  dimensions: Readonly<{ width: number; height: number }>,
): dimensions is Readonly<{ width: number; height: number }> {
  return (
    Number.isSafeInteger(dimensions.width)
    && Number.isSafeInteger(dimensions.height)
    && dimensions.width > 0
    && dimensions.height > 0
    && dimensions.width <= STUDIO_RESVG_BUDGETS.maxDimensionPx
    && dimensions.height <= STUDIO_RESVG_BUDGETS.maxDimensionPx
    && dimensions.width * dimensions.height
      <= STUDIO_RESVG_BUDGETS.maxPixels
  );
}

function safeDestroy(
  destroy: (handle: unknown) => void,
  handle: unknown,
): void {
  try {
    destroy(handle);
  } catch {
    // Continue reverse-order teardown so one cleanup failure cannot retain the
    // other WASM allocation or replace an operation error.
  }
}

function executeRender(
  runtime: StudioResvgRuntime,
  request: PreparedRenderRequest,
): StudioResvgRenderReceipt {
  const options: StudioResvgRuntimeOptions = {
    fit: request.fit,
    fontBuffers: request.fontBuffers.map((font) => Uint8Array.from(font)),
    defaultFontFamily: request.defaultFontFamily,
    languages: [...request.languages],
    background: request.background,
    loadSystemFonts: false,
    loadFontFiles: false,
    resolveExternalImages: false,
    shapeRendering: "geometric-precision",
    textRendering: "optimize-legibility",
    imageRendering: "optimize-quality",
  };
  let renderer: unknown;
  let renderedImage: unknown;
  let hasRenderer = false;
  let hasRenderedImage = false;
  try {
    renderer = runtime.createRenderer(request.svg, options);
    hasRenderer = true;
    const sourceDimensions = runtime.rendererDimensions(renderer);
    if (!validDimensions(sourceDimensions)) {
      throw new StudioResvgProviderError(
        "budget-exceeded",
        "SVG intrinsic dimensions exceed the renderer budget.",
      );
    }
    const unresolvedImages = runtime.unresolvedImages(renderer);
    if (!Array.isArray(unresolvedImages) || unresolvedImages.length > 0) {
      throw new StudioResvgProviderError(
        "unsafe-svg",
        "SVG requested an unresolved external image.",
      );
    }

    renderedImage = runtime.render(renderer);
    hasRenderedImage = true;
    const dimensions = runtime.renderedDimensions(renderedImage);
    if (!validDimensions(dimensions)) {
      throw new StudioResvgProviderError(
        "budget-exceeded",
        "Rendered SVG dimensions exceed the output budget.",
      );
    }
    const expectedRgbaBytes = dimensions.width * dimensions.height * 4;
    if (expectedRgbaBytes > STUDIO_RESVG_BUDGETS.maxRgbaBytes) {
      throw new StudioResvgProviderError(
        "budget-exceeded",
        "Rendered RGBA byte budget exceeded.",
      );
    }
    const runtimeRgba = runtime.rgba(renderedImage);
    if (
      !(runtimeRgba instanceof Uint8Array)
      || runtimeRgba.byteLength !== expectedRgbaBytes
    ) {
      throw new StudioResvgProviderError(
        "invalid-runtime-output",
        "resvg returned an RGBA buffer with an invalid length.",
      );
    }
    const rgba = Uint8Array.from(runtimeRgba);
    const runtimePng = runtime.png(renderedImage);
    if (
      !(runtimePng instanceof Uint8Array)
      || runtimePng.byteLength === 0
      || runtimePng.byteLength > STUDIO_RESVG_BUDGETS.maxPngBytes
    ) {
      throw new StudioResvgProviderError(
        "budget-exceeded",
        "Rendered PNG byte budget exceeded.",
      );
    }
    const png = Uint8Array.from(runtimePng);
    if (
      png.byteLength < PNG_SIGNATURE.length
      || PNG_SIGNATURE.some((byte, index) => png[index] !== byte)
    ) {
      throw new StudioResvgProviderError(
        "invalid-runtime-output",
        "resvg returned an invalid PNG signature.",
      );
    }

    const sanitizedSvgHash = digestText(request.svg);
    const fontReceipts = request.fontBuffers.map((font) => ({
      byteLength: font.byteLength,
      hash: digest(font),
    }));
    const rgbaHash = digest(rgba);
    const pngHash = digest(png);
    const requestHash = digestText(JSON.stringify({
      sanitizedSvgHash,
      fit: request.fit,
      fontMode: request.fontMode,
      fonts: fontReceipts,
      defaultFontFamily: request.defaultFontFamily,
      imagePolicy: request.imagePolicy,
      languages: request.languages,
      background: request.background,
    }));
    const receiptHash = digestText(JSON.stringify({
      requestHash,
      width: dimensions.width,
      height: dimensions.height,
      rgbaHash,
      pngHash,
    }));
    return {
      kind: "studio-resvg-render-receipt",
      revision: STUDIO_RESVG_PROVIDER_REVISION,
      providerId: STUDIO_RESVG_PROVIDER_DESCRIPTOR.id,
      runtimeVersion: runtime.version,
      requestHash,
      sanitizedSvgHash,
      width: dimensions.width,
      height: dimensions.height,
      pixelCount: dimensions.width * dimensions.height,
      fit: { ...request.fit },
      policies: {
        fonts: request.fontMode,
        images: request.imagePolicy,
        systemFonts: false,
        fontFiles: false,
        externalImages: false,
      },
      fonts: fontReceipts,
      rgba: {
        bytes: rgba,
        byteLength: rgba.byteLength,
        hash: rgbaHash,
      },
      png: {
        bytes: png,
        byteLength: png.byteLength,
        hash: pngHash,
      },
      receiptHash,
    };
  } finally {
    if (hasRenderedImage) {
      safeDestroy(
        runtime.destroyRenderedImage.bind(runtime),
        renderedImage,
      );
    }
    if (hasRenderer) {
      safeDestroy(runtime.destroyRenderer.bind(runtime), renderer);
    }
  }
}

function asProviderError(error: unknown): StudioResvgProviderError {
  if (error instanceof StudioResvgProviderError) return error;
  return new StudioResvgProviderError(
    "runtime-failed",
    "resvg rendering runtime failed.",
    { cause: error },
  );
}

export function createStudioResvgSvgProvider(
  options: Readonly<{
    runtimeLoader?: StudioResvgRuntimeLoader;
    maxConcurrentRenders?: number;
  }> = {},
): StudioResvgSvgProvider {
  const runtimeLoader = options.runtimeLoader ?? loadStudioResvgRuntime;
  const maxConcurrentRenders =
    options.maxConcurrentRenders
    ?? STUDIO_RESVG_BUDGETS.maxConcurrentRenders;
  if (
    !Number.isSafeInteger(maxConcurrentRenders)
    || maxConcurrentRenders < 1
    || maxConcurrentRenders > STUDIO_RESVG_BUDGETS.maxConcurrentRenders
  ) {
    throw new RangeError("Invalid resvg concurrent render budget.");
  }

  let state: "ready" | "destroying" | "destroyed" = "ready";
  let runtimePromise: Promise<StudioResvgRuntime> | null = null;
  let runtime: StudioResvgRuntime | null = null;
  let activeRenders = 0;
  let resolveIdle: (() => void) | null = null;
  let destroyPromise: Promise<void> | null = null;

  const loadRuntime = (): Promise<StudioResvgRuntime> => {
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

  return {
    descriptor: STUDIO_RESVG_PROVIDER_DESCRIPTOR,

    async render(request) {
      if (state !== "ready") {
        throw new StudioResvgProviderError(
          "disposed",
          "resvg provider is not ready.",
        );
      }
      if (activeRenders >= maxConcurrentRenders) {
        throw new StudioResvgProviderError(
          "backpressure",
          "resvg concurrent render budget exceeded.",
        );
      }
      const prepared = prepareRequest(request);
      activeRenders += 1;
      try {
        const loaded = await loadRuntime();
        if (state !== "ready") {
          throw new StudioResvgProviderError(
            "disposed",
            "resvg provider was destroyed during initialization.",
          );
        }
        return executeRender(loaded, prepared);
      } catch (error) {
        throw asProviderError(error);
      } finally {
        activeRenders -= 1;
        if (activeRenders === 0) {
          resolveIdle?.();
          resolveIdle = null;
        }
      }
    },

    snapshot() {
      return {
        state,
        runtimeLoaded: runtime !== null,
        activeRenders,
      };
    },

    destroy() {
      if (destroyPromise) return destroyPromise;
      state = "destroying";
      destroyPromise = (async () => {
        if (activeRenders > 0) {
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
}

type ResvgWasmModule = typeof import("@resvg/resvg-wasm");
type ResvgInstance = InstanceType<ResvgWasmModule["Resvg"]>;
type ResvgRenderedImage = ReturnType<ResvgInstance["render"]>;

export function createStudioResvgWasmRuntimeAdapter(
  module: ResvgWasmModule,
): StudioResvgRuntime {
  return {
    version: "resvg-wasm-2.6.2",
    createRenderer(svg, options) {
      return new module.Resvg(svg, {
        fitTo: options.fit,
        font: {
          fontBuffers: options.fontBuffers.map((font) => Uint8Array.from(font)),
          ...(options.defaultFontFamily
            ? { defaultFontFamily: options.defaultFontFamily }
            : {}),
        },
        languages: [...options.languages],
        ...(options.background ? { background: options.background } : {}),
        shapeRendering: 2,
        textRendering: 1,
        imageRendering: 0,
      });
    },
    destroyRenderer(renderer) {
      (renderer as ResvgInstance).free();
    },
    rendererDimensions(renderer) {
      const instance = renderer as ResvgInstance;
      return { width: instance.width, height: instance.height };
    },
    unresolvedImages(renderer) {
      return (renderer as ResvgInstance)
        .imagesToResolve()
        .map((value) => String(value));
    },
    render(renderer) {
      return (renderer as ResvgInstance).render();
    },
    destroyRenderedImage(image) {
      (image as ResvgRenderedImage).free();
    },
    renderedDimensions(image) {
      const rendered = image as ResvgRenderedImage;
      return { width: rendered.width, height: rendered.height };
    },
    rgba(image) {
      return (image as ResvgRenderedImage).pixels;
    },
    png(image) {
      return (image as ResvgRenderedImage).asPng();
    },
    destroy() {
      // The package exposes explicit free() per renderer and rendered image;
      // its initialized module is shared and intentionally remains cached.
    },
  };
}

let productionRuntimePromise: Promise<StudioResvgRuntime> | null = null;

/** Loads and initializes both JS glue and the emitted binary on first use. */
export function loadStudioResvgRuntime(): Promise<StudioResvgRuntime> {
  if (productionRuntimePromise) return productionRuntimePromise;
  productionRuntimePromise = Promise.all([
    import("@resvg/resvg-wasm"),
    import("@resvg/resvg-wasm/index_bg.wasm?url"),
  ])
    .then(async ([module, wasmAsset]) => {
      await module.initWasm(wasmAsset.default);
      return createStudioResvgWasmRuntimeAdapter(module);
    })
    .catch((error: unknown) => {
      productionRuntimePromise = null;
      throw error;
    });
  return productionRuntimePromise;
}
