/**
 * Renderer-neutral registry for lazily initialized Studio specialist providers.
 *
 * A registry entry describes portable capabilities and resource ownership. The
 * loaded implementation may internally use WASM, JavaScript, or a browser GPU
 * API, but opaque handles and surfaces never cross this boundary.
 */

export const STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION = 1 as const;

export const STUDIO_SPECIALIST_PROVIDER_REGISTRY_BUDGETS = Object.freeze({
  maxProviders: 32,
  maxIdCodeUnits: 96,
  maxLabelCodeUnits: 160,
  maxCapabilities: 32,
  maxCapabilityCodeUnits: 96,
  maxRuntimeDependencies: 16,
  maxRuntimeDependencyCodeUnits: 128,
} as const);

export type StudioSpecialistProviderImplementation =
  | "application-core"
  | "js-library"
  | "wasm-library"
  | "native-browser";

export type StudioSpecialistProviderLocality =
  | "main"
  | "worker"
  | "main-or-worker";

export type StudioSpecialistRendererAffinity =
  | "none"
  | "canvas2d"
  | "canvaskit"
  | "pixi"
  | "raw-webgpu";

export type StudioSpecialistProviderCapability =
  | "text:opentype-shaping"
  | "vector:svg-raster-rgba"
  | "vector:svg-raster-png"
  | "vector:path-quality"
  | "raster:composite"
  | "raster:gpu-fx"
  | "image:analysis";

export interface StudioSpecialistProviderDescriptor {
  readonly registryRevision:
    typeof STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION;
  readonly id: string;
  readonly label: string;
  readonly version: number;
  readonly priority: number;
  readonly implementation: StudioSpecialistProviderImplementation;
  readonly locality: StudioSpecialistProviderLocality;
  readonly initialization: "lazy";
  readonly lifecycle: "explicit-destroy";
  readonly capabilities: readonly StudioSpecialistProviderCapability[];
  readonly runtimeDependencies: readonly string[];
  readonly renderer: {
    readonly affinity: StudioSpecialistRendererAffinity;
    readonly ownsSurface: boolean;
  };
  readonly canonicalBoundary: {
    readonly structuredCloneInput: true;
    readonly structuredCloneOutput: true;
    readonly opaqueRuntimeHandles: "forbidden";
  };
}

export interface StudioLoadedSpecialistProvider {
  readonly descriptor: StudioSpecialistProviderDescriptor;
  destroy(): Promise<void> | void;
}

export type StudioSpecialistProviderLoader =
  () => Promise<StudioLoadedSpecialistProvider> | StudioLoadedSpecialistProvider;

export interface StudioSpecialistProviderRegistrySnapshot {
  readonly registryRevision:
    typeof STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION;
  readonly state: "ready" | "destroying" | "destroyed";
  readonly providers: readonly Readonly<{
    id: string;
    version: number;
    priority: number;
    capabilities: readonly StudioSpecialistProviderCapability[];
    loaded: boolean;
  }>[];
}

interface RegistryEntry {
  readonly descriptor: StudioSpecialistProviderDescriptor;
  readonly loader: StudioSpecialistProviderLoader;
  loadPromise: Promise<StudioLoadedSpecialistProvider> | null;
  loaded: StudioLoadedSpecialistProvider | null;
}

const CAPABILITIES = new Set<StudioSpecialistProviderCapability>([
  "text:opentype-shaping",
  "vector:svg-raster-rgba",
  "vector:svg-raster-png",
  "vector:path-quality",
  "raster:composite",
  "raster:gpu-fx",
  "image:analysis",
]);
const IMPLEMENTATIONS = new Set<StudioSpecialistProviderImplementation>([
  "application-core",
  "js-library",
  "wasm-library",
  "native-browser",
]);
const LOCALITIES = new Set<StudioSpecialistProviderLocality>([
  "main",
  "worker",
  "main-or-worker",
]);
const RENDERER_AFFINITIES = new Set<StudioSpecialistRendererAffinity>([
  "none",
  "canvas2d",
  "canvaskit",
  "pixi",
  "raw-webgpu",
]);
const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?$/u;

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isBoundedIdentifier(value: unknown, maxCodeUnits: number): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= maxCodeUnits
    && IDENTIFIER_PATTERN.test(value)
  );
}

export function isStudioSpecialistProviderDescriptor(
  value: unknown,
): value is StudioSpecialistProviderDescriptor {
  if (!value || typeof value !== "object") return false;
  const descriptor = value as Partial<StudioSpecialistProviderDescriptor>;
  if (
    descriptor.registryRevision !== STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION
    || !isBoundedIdentifier(
      descriptor.id,
      STUDIO_SPECIALIST_PROVIDER_REGISTRY_BUDGETS.maxIdCodeUnits,
    )
    || typeof descriptor.label !== "string"
    || descriptor.label.trim().length === 0
    || descriptor.label.length
      > STUDIO_SPECIALIST_PROVIDER_REGISTRY_BUDGETS.maxLabelCodeUnits
    || !Number.isSafeInteger(descriptor.version)
    || (descriptor.version ?? 0) < 1
    || !Number.isSafeInteger(descriptor.priority)
    || !IMPLEMENTATIONS.has(
      descriptor.implementation as StudioSpecialistProviderImplementation,
    )
    || !LOCALITIES.has(
      descriptor.locality as StudioSpecialistProviderLocality,
    )
    || descriptor.initialization !== "lazy"
    || descriptor.lifecycle !== "explicit-destroy"
    || !Array.isArray(descriptor.capabilities)
    || descriptor.capabilities.length === 0
    || descriptor.capabilities.length
      > STUDIO_SPECIALIST_PROVIDER_REGISTRY_BUDGETS.maxCapabilities
    || !descriptor.capabilities.every(
      (capability) =>
        typeof capability === "string"
        && capability.length
          <= STUDIO_SPECIALIST_PROVIDER_REGISTRY_BUDGETS.maxCapabilityCodeUnits
        && CAPABILITIES.has(
          capability as StudioSpecialistProviderCapability,
        ),
    )
    || !hasUniqueStrings(descriptor.capabilities)
    || !Array.isArray(descriptor.runtimeDependencies)
    || descriptor.runtimeDependencies.length
      > STUDIO_SPECIALIST_PROVIDER_REGISTRY_BUDGETS.maxRuntimeDependencies
    || !descriptor.runtimeDependencies.every(
      (dependency) =>
        isBoundedIdentifier(
          dependency,
          STUDIO_SPECIALIST_PROVIDER_REGISTRY_BUDGETS
            .maxRuntimeDependencyCodeUnits,
        ),
    )
    || !hasUniqueStrings(descriptor.runtimeDependencies)
    || !descriptor.renderer
    || !RENDERER_AFFINITIES.has(descriptor.renderer.affinity)
    || typeof descriptor.renderer.ownsSurface !== "boolean"
    || (descriptor.renderer.affinity === "none"
      && descriptor.renderer.ownsSurface)
    || !descriptor.canonicalBoundary
    || descriptor.canonicalBoundary.structuredCloneInput !== true
    || descriptor.canonicalBoundary.structuredCloneOutput !== true
    || descriptor.canonicalBoundary.opaqueRuntimeHandles !== "forbidden"
  ) {
    return false;
  }
  return true;
}

function cloneDescriptor(
  descriptor: StudioSpecialistProviderDescriptor,
): StudioSpecialistProviderDescriptor {
  return Object.freeze({
    ...descriptor,
    capabilities: Object.freeze([...descriptor.capabilities]),
    runtimeDependencies: Object.freeze([...descriptor.runtimeDependencies]),
    renderer: Object.freeze({ ...descriptor.renderer }),
    canonicalBoundary: Object.freeze({ ...descriptor.canonicalBoundary }),
  });
}

/**
 * Loads providers only when selected. Failed loads are retryable, successful
 * loads are cached, and teardown runs in reverse registration order.
 */
export class StudioSpecialistProviderRegistry {
  readonly #entries = new Map<string, RegistryEntry>();
  #state: StudioSpecialistProviderRegistrySnapshot["state"] = "ready";
  #destroyPromise: Promise<void> | null = null;

  register(
    descriptorValue: StudioSpecialistProviderDescriptor,
    loader: StudioSpecialistProviderLoader,
  ): void {
    if (this.#state !== "ready") {
      throw new Error("Studio specialist provider registry is not ready.");
    }
    if (!isStudioSpecialistProviderDescriptor(descriptorValue)) {
      throw new TypeError("Invalid Studio specialist provider descriptor.");
    }
    if (typeof loader !== "function") {
      throw new TypeError("Studio specialist provider loader must be a function.");
    }
    if (
      this.#entries.size
      >= STUDIO_SPECIALIST_PROVIDER_REGISTRY_BUDGETS.maxProviders
    ) {
      throw new RangeError("Studio specialist provider registry budget exceeded.");
    }
    if (this.#entries.has(descriptorValue.id)) {
      throw new Error(`Duplicate Studio specialist provider: ${descriptorValue.id}`);
    }
    const descriptor = cloneDescriptor(descriptorValue);
    this.#entries.set(descriptor.id, {
      descriptor,
      loader,
      loadPromise: null,
      loaded: null,
    });
  }

  descriptors(
    capability?: StudioSpecialistProviderCapability,
  ): readonly StudioSpecialistProviderDescriptor[] {
    const matches = [...this.#entries.values()]
      .map(({ descriptor }) => descriptor)
      .filter(
        (descriptor) =>
          capability === undefined
          || descriptor.capabilities.includes(capability),
      )
      .sort(
        (left, right) =>
          right.priority - left.priority
          || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      );
    return Object.freeze(matches);
  }

  async load(id: string): Promise<StudioLoadedSpecialistProvider> {
    if (this.#state !== "ready") {
      throw new Error("Studio specialist provider registry is not ready.");
    }
    const entry = this.#entries.get(id);
    if (!entry) throw new Error(`Unknown Studio specialist provider: ${id}`);
    if (entry.loaded) return entry.loaded;
    if (entry.loadPromise) return entry.loadPromise;

    const pending = Promise.resolve()
      .then(entry.loader)
      .then((provider) => {
        if (
          !provider
          || provider.descriptor.id !== entry.descriptor.id
          || provider.descriptor.version !== entry.descriptor.version
          || typeof provider.destroy !== "function"
        ) {
          throw new TypeError(
            `Loaded Studio specialist provider does not match ${entry.descriptor.id}.`,
          );
        }
        entry.loaded = provider;
        return provider;
      })
      .catch((error: unknown) => {
        entry.loadPromise = null;
        throw error;
      });
    entry.loadPromise = pending;
    return pending;
  }

  snapshot(): StudioSpecialistProviderRegistrySnapshot {
    return {
      registryRevision: STUDIO_SPECIALIST_PROVIDER_REGISTRY_REVISION,
      state: this.#state,
      providers: [...this.#entries.values()].map((entry) => ({
        id: entry.descriptor.id,
        version: entry.descriptor.version,
        priority: entry.descriptor.priority,
        capabilities: [...entry.descriptor.capabilities],
        loaded: entry.loaded !== null,
      })),
    };
  }

  async destroy(): Promise<void> {
    if (this.#destroyPromise) return this.#destroyPromise;
    this.#state = "destroying";
    this.#destroyPromise = (async () => {
      const entries = [...this.#entries.values()].reverse();
      await Promise.allSettled(
        entries
          .map(({ loadPromise }) => loadPromise)
          .filter((value): value is Promise<StudioLoadedSpecialistProvider> =>
            value !== null
          ),
      );
      for (const entry of entries) {
        if (!entry.loaded) continue;
        await entry.loaded.destroy();
        entry.loaded = null;
      }
      this.#state = "destroyed";
    })();
    return this.#destroyPromise;
  }
}
