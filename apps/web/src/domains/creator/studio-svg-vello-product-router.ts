import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_SVG_PRODUCT_ROUTE_REVISION = 2 as const;
export const STUDIO_SVG_PRODUCT_SELECTED_PROVIDER_ID = "vello-svg-native" as const;
export const STUDIO_SVG_PRODUCT_BUDGETS = Object.freeze({
  maxSourceCodeUnits: 2 * 1024 * 1024,
  maxDimensionPx: 4_096,
  maxPixels: 1_048_576,
  maxCachedEntries: 24,
  maxCachedPixelBytes: 8 * 1024 * 1024,
  maxConcurrentResolutions: 2,
});

export type StudioSvgProductSelectedProviderId =
  typeof STUDIO_SVG_PRODUCT_SELECTED_PROVIDER_ID;
export type StudioSvgProductProviderId = StudioSvgProductSelectedProviderId | "rejected";
export type StudioSvgProductTrust = "bundled-catalog" | "user-import";

export interface StudioSvgProductInput {
  readonly assetId: string;
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly trust: StudioSvgProductTrust;
  /** Selected before resolution starts and immutable for the request lifetime. */
  readonly selectedProviderId: StudioSvgProductSelectedProviderId;
}

export interface StudioSvgProductPixels {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export interface StudioSvgProductAudit {
  readonly elementCount: number;
  readonly maxDepth: number;
  readonly localReferenceCount: number;
}

export interface StudioSvgProductDecision {
  readonly kind: "studio-svg-product-decision";
  readonly revision: typeof STUDIO_SVG_PRODUCT_ROUTE_REVISION;
  readonly assetId: string;
  readonly sourceDigest: `sha256:${string}`;
  readonly selectedProviderId: StudioSvgProductSelectedProviderId;
  readonly providerId: StudioSvgProductProviderId;
  readonly route: "selected-vello-native" | "fail-closed";
  readonly audit: StudioSvgProductAudit | null;
  readonly pixels: StudioSvgProductPixels | null;
  readonly sourcePreserved: true;
  readonly editable: false;
  readonly interactiveGpuReadbackBytes: 0;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly unsupported: readonly string[];
}

export interface StudioSvgProductEngines {
  auditVello(svg: string): Promise<StudioSvgProductAudit>;
  renderVelloCpu(svg: string, width: number, height: number): Promise<Uint8Array>;
}

export interface StudioSvgProductTournamentMetrics {
  readonly cachedEntries: number;
  readonly cachedPixelBytes: number;
  readonly inFlight: number;
  readonly active: number;
  readonly queued: number;
}

function asReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error);
}

function sourceDigest(input: StudioSvgProductInput): `sha256:${string}` {
  return `sha256:${sha256HexPortable(
    new TextEncoder().encode(`${input.width}x${input.height}\u0000${input.svg}`),
  )}`;
}

function routingCacheKey(input: StudioSvgProductInput): string {
  return `${input.selectedProviderId}\u0000${input.assetId}\u0000${sourceDigest(input)}`;
}

function inputIssue(input: StudioSvgProductInput): string | null {
  if (!input.assetId.trim()) return "asset id is empty";
  if (!input.svg.trim()) return "SVG source is empty";
  if (input.svg.length > STUDIO_SVG_PRODUCT_BUDGETS.maxSourceCodeUnits) {
    return "SVG source exceeds the 2 MiB product budget";
  }
  if (
    !Number.isInteger(input.width)
    || !Number.isInteger(input.height)
    || input.width <= 0
    || input.height <= 0
    || input.width > STUDIO_SVG_PRODUCT_BUDGETS.maxDimensionPx
    || input.height > STUDIO_SVG_PRODUCT_BUDGETS.maxDimensionPx
    || input.width * input.height > STUDIO_SVG_PRODUCT_BUDGETS.maxPixels
  ) {
    return "SVG preview dimensions exceed the bounded product surface";
  }
  if (input.selectedProviderId !== STUDIO_SVG_PRODUCT_SELECTED_PROVIDER_ID) {
    return "selected SVG provider is unsupported";
  }
  return null;
}

function activeOrExternalSvg(svg: string): boolean {
  return (
    /<!doctype\b|<!entity\b|<\s*(?:script|foreignObject|iframe|object|embed)\b/iu.test(svg)
    || /\bon[a-z0-9_-]+\s*=/iu.test(svg)
    || /(?:javascript|vbscript)\s*:/iu.test(svg)
    || /\b(?:href|xlink:href)\s*=\s*["'](?!#|data:image\/(?:png|jpeg|webp|gif);base64,)/iu.test(svg)
    || /url\(\s*["']?(?!#)/iu.test(svg)
  );
}

function pixelsFromBytes(
  bytes: Uint8Array,
  width: number,
  height: number,
): StudioSvgProductPixels {
  if (bytes.byteLength !== width * height * 4) {
    throw new Error(
      `renderer returned ${bytes.byteLength} bytes for ${width}x${height} RGBA`,
    );
  }
  return { width, height, bytes };
}

function decision(
  input: StudioSvgProductInput,
  values: Omit<
    StudioSvgProductDecision,
    "assetId" | "kind" | "revision" | "selectedProviderId" | "sourceDigest"
  > & { readonly sourceDigest?: `sha256:${string}` },
): StudioSvgProductDecision {
  return Object.freeze({
    kind: "studio-svg-product-decision",
    revision: STUDIO_SVG_PRODUCT_ROUTE_REVISION,
    assetId: input.assetId,
    sourceDigest: values.sourceDigest ?? sourceDigest(input),
    selectedProviderId: input.selectedProviderId,
    providerId: values.providerId,
    route: values.route,
    audit: values.audit,
    pixels: values.pixels,
    sourcePreserved: true,
    editable: false,
    interactiveGpuReadbackBytes: 0,
    reasons: Object.freeze([...values.reasons]),
    warnings: Object.freeze([...values.warnings]),
    unsupported: Object.freeze([...values.unsupported]),
  });
}

function rejectedDecision(
  input: StudioSvgProductInput,
  reason: string,
  options: Readonly<{
    audit?: StudioSvgProductAudit | null;
    sourceDigest?: `sha256:${string}`;
    unsupported?: readonly string[];
  }> = {},
): StudioSvgProductDecision {
  return decision(input, {
    sourceDigest: options.sourceDigest,
    providerId: "rejected",
    route: "fail-closed",
    audit: options.audit ?? null,
    pixels: null,
    editable: false,
    reasons: [reason],
    warnings: [],
    unsupported: options.unsupported ?? [],
    sourcePreserved: true,
    interactiveGpuReadbackBytes: 0,
  });
}

async function evaluateStudioSvgProductRoute(
  input: StudioSvgProductInput,
  engines: StudioSvgProductEngines,
): Promise<StudioSvgProductDecision> {
  const invalid = inputIssue(input);
  if (invalid) {
    return rejectedDecision(input, invalid, {
      sourceDigest: `sha256:${sha256HexPortable(
        new TextEncoder().encode(input.svg.slice(0, 4_096)),
      )}`,
    });
  }

  if (activeOrExternalSvg(input.svg)) {
    return rejectedDecision(input, "active or externally resolved SVG content is forbidden", {
      unsupported: ["security:active-or-external-content"],
    });
  }

  let audit: StudioSvgProductAudit | null = null;
  try {
    audit = await engines.auditVello(input.svg);
    const bytes = await engines.renderVelloCpu(input.svg, input.width, input.height);
    return decision(input, {
      providerId: input.selectedProviderId,
      route: "selected-vello-native",
      audit,
      pixels: pixelsFromBytes(bytes, input.width, input.height),
      editable: false,
      reasons: ["the preselected Vello provider completed the bounded SVG preview"],
      warnings: [],
      unsupported: [],
      sourcePreserved: true,
      interactiveGpuReadbackBytes: 0,
    });
  } catch (error) {
    return rejectedDecision(
      input,
      `selected provider ${input.selectedProviderId} failed: ${asReason(error)}`,
      { audit },
    );
  }
}

/**
 * Historical name retained for the injected product seam. Each resolution now
 * executes exactly one provider selected in the immutable request snapshot.
 */
export class StudioSvgProductTournament {
  private readonly cache = new Map<string, StudioSvgProductDecision>();
  private readonly inFlight = new Map<string, Promise<StudioSvgProductDecision>>();
  private readonly queue: Array<() => void> = [];
  private cachedPixelBytes = 0;
  private active = 0;

  constructor(
    private readonly engines: StudioSvgProductEngines,
    private readonly limits: Readonly<{
      maxCachedEntries: number;
      maxCachedPixelBytes: number;
      maxConcurrentResolutions: number;
    }> = STUDIO_SVG_PRODUCT_BUDGETS,
  ) {
    if (
      !Number.isInteger(limits.maxCachedEntries)
      || limits.maxCachedEntries < 1
      || !Number.isInteger(limits.maxCachedPixelBytes)
      || limits.maxCachedPixelBytes < 1
      || !Number.isInteger(limits.maxConcurrentResolutions)
      || limits.maxConcurrentResolutions < 1
    ) {
      throw new RangeError("invalid SVG product tournament limits");
    }
  }

  resolve(input: StudioSvgProductInput): Promise<StudioSvgProductDecision> {
    const request = Object.freeze({ ...input });
    const key = routingCacheKey(request);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const work = this.schedule(() => evaluateStudioSvgProductRoute(request, this.engines))
      .then((result) => {
        this.store(key, result);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, work);
    return work;
  }

  metrics(): StudioSvgProductTournamentMetrics {
    return {
      cachedEntries: this.cache.size,
      cachedPixelBytes: this.cachedPixelBytes,
      inFlight: this.inFlight.size,
      active: this.active,
      queued: this.queue.length,
    };
  }

  clear(): void {
    this.cache.clear();
    this.cachedPixelBytes = 0;
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        void task().then(resolve, reject).finally(() => {
          this.active -= 1;
          this.queue.shift()?.();
        });
      };
      if (this.active < this.limits.maxConcurrentResolutions) start();
      else this.queue.push(start);
    });
  }

  private store(key: string, result: StudioSvgProductDecision): void {
    const pixelBytes = result.pixels?.bytes.byteLength ?? 0;
    if (pixelBytes > this.limits.maxCachedPixelBytes) return;
    this.cache.set(key, result);
    this.cachedPixelBytes += pixelBytes;
    while (
      this.cache.size > this.limits.maxCachedEntries
      || this.cachedPixelBytes > this.limits.maxCachedPixelBytes
    ) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      this.cachedPixelBytes -= oldest?.pixels?.bytes.byteLength ?? 0;
    }
  }
}

export const STUDIO_SVG_PRODUCT_ENGINES: StudioSvgProductEngines = {
  async auditVello(svg) {
    const engine = await import("@toonspectrum/studio-engine-vello");
    await engine.loadVelloSvgNative();
    return engine.auditSvgNative(svg);
  },
  async renderVelloCpu(svg, width, height) {
    const engine = await import("@toonspectrum/studio-engine-vello");
    await engine.loadVelloSvgNative();
    return engine.renderSvgToPixelsVelloCpu(svg, width, height);
  },
};

export const studioSvgProductTournament = new StudioSvgProductTournament(
  STUDIO_SVG_PRODUCT_ENGINES,
);
