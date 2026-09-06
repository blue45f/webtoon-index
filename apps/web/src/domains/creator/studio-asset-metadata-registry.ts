import {
  canvasKitImageFilterDescriptor,
  openCvImageWorkerDescriptor,
  wasmVipsPipelineDescriptor,
} from "@toonspectrum/studio-engine-registry";
import {
  assertAssetCapabilitiesKnown,
  canonicalJson,
  collectSceneFeatures,
  computeAssetContentDigest,
  computeAssetStructuredDigest,
  parseAssetMetadata,
  sceneFeatureCapabilityVocabulary,
} from "@toonspectrum/studio-project-model";

// Descriptor-only modules are imported by file path (same precedent as
// studio-live-ink-stabilizer-plan.ts): the package INDEX of the skia/vello
// engines drags in canvaskit-wasm / wasm loader sources that the root app
// program must not typecheck or bundle, while these descriptor modules are
// pure data.
import {
  googleInkMeshProviderDescriptor,
  hokusaiProviderDescriptor,
  perfectFreehandProviderDescriptor,
} from "../../../../../packages/studio-brush-platform/src/providers";
import {
  canvasKitGpuProviderDescriptor,
  canvasKitProviderDescriptor,
  skiaGraphiteWebgpuProviderDescriptor,
} from "../../../../../packages/studio-engine-skia/src/descriptor";
import {
  velloCpuProviderDescriptor,
  velloGpuBrowserProviderDescriptor,
  velloSvgNativeProviderDescriptor,
} from "../../../../../packages/studio-engine-vello/src/descriptor";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";
import type { KppImportResult } from "../../../../../packages/studio-format-gateway/src/kpp";
import type { MybImportResult } from "../../../../../packages/studio-format-gateway/src/myb";
import type { SvgImportResult } from "../../../../../packages/studio-format-gateway/src/svg";
import type {
  EngineCapabilityRegistry,
  ProviderDescriptor,
} from "@toonspectrum/studio-engine-registry";
import type {
  AssetKindIR,
  AssetLicenseIR,
  AssetMetadataIR,
  AssetNormalizedIrReference,
  AssetProviderRequirementIR,
  AssetRendererVariantIR,
  BrushProgramIR,
} from "@toonspectrum/studio-project-model";

/**
 * V12 §15 — asset ecosystem engine metadata registry.
 *
 * Holds AssetMetadataIR cards (the AssetPackage "provider requirements +
 * license/SPDX/provenance" slice), answers "can the CURRENT engine set render
 * this material?" against the EngineCapabilityRegistry, and persists through
 * the studio-local-database kv namespace — no new tables, no migrations.
 */

// ---------------------------------------------------------------------------
// Capability vocabulary
// ---------------------------------------------------------------------------

/**
 * Every provider descriptor the studio ships today. This is the KNOWN
 * capability universe used to reject unregisterable metadata; whether a
 * material is renderable RIGHT NOW is judged separately against whatever
 * subset is actually registered on the device (see judgeAssetRenderability).
 */
export const STUDIO_KNOWN_ENGINE_DESCRIPTORS: readonly ProviderDescriptor[] = [
  canvasKitProviderDescriptor,
  // Vello 갭(text.paragraph/mask/filter.image/backdrop/path-effect)의 지정 완성 레인과 그
  // WebGPU 챌린저(ADR 0017). known universe 등재는 활성화가 아니다 — 등록 권한(evidence)은
  // 그대로이며, capability-gap 커버리지 테스트가 이 두 id의 존재를 강제한다.
  canvasKitGpuProviderDescriptor,
  skiaGraphiteWebgpuProviderDescriptor,
  velloCpuProviderDescriptor,
  velloGpuBrowserProviderDescriptor,
  velloSvgNativeProviderDescriptor,
  perfectFreehandProviderDescriptor,
  googleInkMeshProviderDescriptor,
  hokusaiProviderDescriptor,
  canvasKitImageFilterDescriptor,
  openCvImageWorkerDescriptor,
  wasmVipsPipelineDescriptor,
];

/**
 * Full asset capability vocabulary: the union of every descriptor's declared
 * capabilities plus the scene-feature tokens `collectSceneFeatures` can emit
 * (an SVG using a blend no provider declares yet must still REGISTER — it is
 * a renderability verdict, not an unknown token).
 */
export function studioAssetCapabilityVocabulary(
  descriptors: readonly ProviderDescriptor[] = STUDIO_KNOWN_ENGINE_DESCRIPTORS,
): ReadonlySet<string> {
  const vocabulary = new Set<string>(sceneFeatureCapabilityVocabulary());
  for (const descriptor of descriptors) {
    for (const capability of descriptor.capabilities) vocabulary.add(capability);
  }
  return vocabulary;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const STUDIO_ASSET_METADATA_KV_NAMESPACE = "asset-metadata";
export const STUDIO_ASSET_METADATA_CATALOG_KEY = "catalog.v1";
export const STUDIO_ASSET_METADATA_CATALOG_REVISION = 1 as const;

export class StudioAssetMetadataRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioAssetMetadataRegistryError";
  }
}

export interface StudioAssetRenderabilityReport {
  assetId: string;
  /** True when every required capability is declared by ≥1 registered provider. */
  renderable: boolean;
  /** Required capabilities no registered provider declares (sorted). */
  missingCapabilities: string[];
  /** capability token → provider ids declaring it (sorted; [] when missing). */
  capabilityProviders: Record<string, string[]>;
}

/**
 * Judges whether `metadata` can render on the CURRENT engine set. Union
 * semantics on purpose: the hybrid planner routes islands to different
 * providers, so a material is renderable when each required capability is
 * declared by at least one registered provider — not necessarily the same one.
 */
export function judgeAssetRenderability(
  metadata: AssetMetadataIR,
  engines: EngineCapabilityRegistry,
): StudioAssetRenderabilityReport {
  const providers = engines.list();
  const capabilityProviders: Record<string, string[]> = {};
  const missingCapabilities: string[] = [];
  for (const token of [...new Set(metadata.engineRequirements)].sort()) {
    const declaring = providers
      .filter((provider) => provider.descriptor.capabilities.includes(token))
      .map((provider) => provider.descriptor.id)
      .sort();
    capabilityProviders[token] = declaring;
    if (declaring.length === 0) missingCapabilities.push(token);
  }
  return {
    assetId: metadata.id,
    renderable: missingCapabilities.length === 0,
    missingCapabilities,
    capabilityProviders,
  };
}

interface PersistedCatalog {
  revision: number;
  assets: unknown[];
}

export class StudioAssetMetadataRegistry {
  private readonly assets = new Map<string, AssetMetadataIR>();
  private readonly vocabulary: ReadonlySet<string>;

  constructor(vocabulary: Iterable<string> = studioAssetCapabilityVocabulary()) {
    this.vocabulary =
      vocabulary instanceof Set ? vocabulary : new Set(vocabulary);
  }

  /**
   * Validates (schema + capability vocabulary) and registers. Duplicate ids
   * and unknown capability tokens are rejected loudly — a card that cannot
   * be matched against any engine must never enter the catalog silently.
   */
  register(candidate: unknown): AssetMetadataIR {
    const metadata = parseAssetMetadata(candidate);
    if (this.assets.has(metadata.id)) {
      throw new StudioAssetMetadataRegistryError(
        `asset already registered: ${metadata.id}`,
      );
    }
    assertAssetCapabilitiesKnown(metadata, this.vocabulary);
    this.assets.set(metadata.id, metadata);
    return metadata;
  }

  get(id: string): AssetMetadataIR | null {
    return this.assets.get(id) ?? null;
  }

  list(kind?: AssetKindIR): AssetMetadataIR[] {
    const all = [...this.assets.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    return kind === undefined ? all : all.filter((asset) => asset.kind === kind);
  }

  judgeRenderability(
    id: string,
    engines: EngineCapabilityRegistry,
  ): StudioAssetRenderabilityReport {
    const metadata = this.assets.get(id);
    if (metadata === undefined) {
      throw new StudioAssetMetadataRegistryError(`asset not registered: ${id}`);
    }
    return judgeAssetRenderability(metadata, engines);
  }

  /**
   * Persists the whole catalog as ONE canonical-JSON snapshot under the
   * "asset-metadata" kv namespace. A single key means a torn multi-key
   * update cannot exist; canonicalJson means byte-identical snapshots for
   * identical catalogs.
   */
  async saveTo(store: StudioAsyncKeyValueStore): Promise<void> {
    const catalog: PersistedCatalog = {
      revision: STUDIO_ASSET_METADATA_CATALOG_REVISION,
      assets: this.list(),
    };
    await store.set(STUDIO_ASSET_METADATA_CATALOG_KEY, canonicalJson(catalog));
  }

  /**
   * Loads a catalog snapshot. A missing key is an empty registry; anything
   * unreadable (bad JSON, wrong revision, invalid entry) throws — corrupted
   * catalogs are surfaced, never partially and silently dropped.
   */
  static async loadFrom(
    store: StudioAsyncKeyValueStore,
    vocabulary: Iterable<string> = studioAssetCapabilityVocabulary(),
  ): Promise<StudioAssetMetadataRegistry> {
    const registry = new StudioAssetMetadataRegistry(vocabulary);
    const payload = await store.get(STUDIO_ASSET_METADATA_CATALOG_KEY);
    if (payload === null) return registry;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      throw new StudioAssetMetadataRegistryError(
        `asset-metadata catalog is not valid JSON: ${(error as Error).message}`,
      );
    }
    const catalog = parsed as Partial<PersistedCatalog> | null;
    if (
      catalog === null ||
      typeof catalog !== "object" ||
      catalog.revision !== STUDIO_ASSET_METADATA_CATALOG_REVISION ||
      !Array.isArray(catalog.assets)
    ) {
      throw new StudioAssetMetadataRegistryError(
        "asset-metadata catalog has an unknown shape or revision — refusing " +
          "a lossy partial load",
      );
    }
    for (const entry of catalog.assets) registry.register(entry);
    return registry;
  }
}

// ---------------------------------------------------------------------------
// Derivation from format-gateway outputs (the real wiring proof)
// ---------------------------------------------------------------------------

export interface DeriveAssetIdentity {
  id: string;
  name?: string;
  /** Defaults to "1.0.0" — imported materials start at their first release. */
  version?: string;
  license: AssetLicenseIR;
  sourceFileName?: string | null;
  now?: () => number;
}

export type DeriveAssetMetadataInput =
  | { format: "myb"; bytes: Uint8Array; result: MybImportResult }
  | { format: "kpp"; bytes: Uint8Array; result: KppImportResult }
  | { format: "svg"; svgText: string; result: SvgImportResult };

/**
 * Engine requirements of an imported brush program, grounded in the shipped
 * provider vocabulary (no invented tokens):
 * - vector-path output executes on the stroke-geometry outline lane
 *   → "stroke.geometry.pressure-outline"
 * - vector-mesh output executes on the Google Ink mesh lane
 *   → "stroke.geometry.ink-mesh" (declared only by the google-ink-mesh
 *   provider — the requirement fails closed on hosts without the ink WASM
 *   lane instead of resolving to outline geometry)
 * - a hokusai provider preference means faithful rendering needs the
 *   natural-media lane → "brush.natural-media.dynamics"
 * - `.myb` payloads additionally need the myb interpreter
 *   → "brush.natural-media.myb"
 */
function deriveBrushEngineRequirements(
  program: BrushProgramIR,
  sourceFormat: "myb" | "kpp",
): string[] {
  const requirements = new Set<string>();
  if (program.output.target === "vector-path") {
    requirements.add("stroke.geometry.pressure-outline");
  }
  if (program.output.target === "vector-mesh") {
    requirements.add("stroke.geometry.ink-mesh");
  }
  if (
    sourceFormat === "myb" ||
    program.providerPreference.includes("hokusai-natural-media")
  ) {
    requirements.add("brush.natural-media.dynamics");
  }
  if (sourceFormat === "myb") {
    requirements.add("brush.natural-media.myb");
  }
  return [...requirements].sort();
}

function descriptorById(providerId: string): ProviderDescriptor {
  const descriptor = STUDIO_KNOWN_ENGINE_DESCRIPTORS.find(
    (candidate) => candidate.id === providerId,
  );
  if (descriptor === undefined) {
    throw new StudioAssetMetadataRegistryError(
      `cannot derive asset metadata for unknown provider: ${providerId}`,
    );
  }
  return descriptor;
}

function deriveProviderRequirements(
  capabilities: readonly string[],
): AssetProviderRequirementIR[] {
  return [...new Set(capabilities)]
    .sort()
    .map((capability) => ({
      capability,
      providerIds: STUDIO_KNOWN_ENGINE_DESCRIPTORS
        .filter((descriptor) => descriptor.capabilities.includes(capability))
        .map((descriptor) => descriptor.id)
        .sort(),
      // Provider descriptor versions are exact deployment identities and are
      // not uniformly semver (some pin multiple native crates). A fabricated
      // semver range would be less truthful than an explicit null.
      versionRange: null,
      optional: false,
      reason: `Normalized IR requires ${capability}.`,
    }));
}

function originalBlobRef(
  content: Uint8Array | string,
  mediaType: string,
) {
  return {
    digest: computeAssetContentDigest(content),
    byteLength:
      typeof content === "string"
        ? new TextEncoder().encode(content).byteLength
        : content.byteLength,
    mediaType,
    // Import does not itself persist to CAS/OPFS. A locator is populated only
    // after the storage layer has durably committed the exact digest.
    locator: null,
  };
}

function normalizedIrRef(
  value: unknown,
  schema: "toonspectrum.brush-program-ir" | "toonspectrum.scene-ir",
  mediaType: string,
): AssetNormalizedIrReference {
  return {
    digest: computeAssetStructuredDigest(value),
    schema,
    schemaVersion: 11,
    mediaType,
    // Same truthfulness rule as originalBlobRef: no storage receipt, no URL.
    locator: null,
  };
}

function rendererVariant(
  id: string,
  tier: "stable" | "studio-max",
  providerId: string,
  normalizedReference: AssetNormalizedIrReference,
  requiredCapabilities: readonly string[],
  limitations: readonly string[],
): AssetRendererVariantIR {
  const descriptor = descriptorById(providerId);
  const unsupported = requiredCapabilities.filter(
    (capability) => !descriptor.capabilities.includes(capability),
  );
  if (unsupported.length > 0) {
    throw new StudioAssetMetadataRegistryError(
      `provider ${providerId} cannot back renderer variant ${id}; missing ` +
        unsupported.join(", "),
    );
  }
  return {
    id,
    tier,
    providerId,
    providerVersion: descriptor.version,
    normalizedIrRef: normalizedReference,
    requiredCapabilities: [...requiredCapabilities],
    // Descriptor maturity is not asset-specific visual evidence. Imported
    // cards remain unmeasured until the exact material is rendered and gated.
    qualityStatus: "unmeasured",
    determinism: "unmeasured",
    limitations: [...limitations],
  };
}

function importedPreviewVariants(
  stableRendererVariantId: string | null,
  studioMaxRendererVariantId: string | null,
) {
  return {
    stable: {
      status: "not-generated" as const,
      artifactRef: null,
      rendererVariantId: stableRendererVariantId,
      realStrokePreviewIds: [],
      reason:
        "Format import produced normalized IR but did not render a stable preview artifact.",
    },
    studioMax: {
      status: "not-generated" as const,
      artifactRef: null,
      rendererVariantId: studioMaxRendererVariantId,
      realStrokePreviewIds: [],
      reason:
        "Format import produced normalized IR but did not run the Studio Max renderer or quality gate.",
    },
  };
}

function unlistedMarketplace(sourceFormat: "myb" | "kpp" | "svg") {
  return {
    status: "not-listed" as const,
    listingId: null,
    publisherId: null,
    access: null,
    category: null,
    tags: [sourceFormat],
    commercialUseAllowed: null,
    attributionRequired: null,
    updatedAt: null,
  };
}

/**
 * Derives an AssetMetadataIR card from a format-gateway import result. The
 * digest always covers the ORIGINAL payload (bytes / source text), and the
 * importer's unmapped/warning ledgers ride into provenance verbatim so the
 * zero-silent-loss trail survives into the marketplace layer.
 */
export function deriveAssetMetadata(
  input: DeriveAssetMetadataInput,
  identity: DeriveAssetIdentity,
): AssetMetadataIR {
  const now = identity.now ?? Date.now;
  const base = {
    id: identity.id,
    version: identity.version ?? "1.0.0",
    license: identity.license,
    createdAt: now(),
  };
  const provenanceBase = {
    sourceFileName: identity.sourceFileName ?? null,
    importedAt: base.createdAt,
  };

  let candidate: unknown;
  switch (input.format) {
    case "myb": {
      const { preset, unmappedSettings } = input.result;
      const engineRequirements = deriveBrushEngineRequirements(preset, "myb");
      const normalizedReference = normalizedIrRef(
        preset,
        "toonspectrum.brush-program-ir",
        "application/vnd.toonspectrum.brush-program+json",
      );
      const hokusaiCapabilities = engineRequirements.filter((capability) =>
        descriptorById("hokusai-natural-media").capabilities.includes(capability),
      );
      const outlineCapabilities = engineRequirements.filter((capability) =>
        descriptorById("perfect-freehand").capabilities.includes(capability),
      );
      candidate = {
        ...base,
        kind: "brush-program",
        name: identity.name ?? preset.name,
        engineRequirements,
        providerRequirements: deriveProviderRequirements(engineRequirements),
        sourceFormat: "myb",
        contentDigest: computeAssetContentDigest(input.bytes),
        originalBlobRef: originalBlobRef(input.bytes, "application/json"),
        normalizedIrRef: normalizedReference,
        rendererVariants: [
          rendererVariant(
            "stable-hokusai",
            "stable",
            "hokusai-natural-media",
            normalizedReference,
            hokusaiCapabilities,
            ["Natural-media tiles require the raster surface owner for compositing."],
          ),
          ...(outlineCapabilities.length === 0
            ? []
            : [
                rendererVariant(
                  "stable-perfect-freehand",
                  "stable",
                  "perfect-freehand",
                  normalizedReference,
                  outlineCapabilities,
                  ["Natural-media mixing and MYB dab dynamics are not reproduced."],
                ),
              ]),
        ],
        realStrokePreviews: [],
        deviceProfiles: [],
        visualEquivalenceReport: null,
        dependencies: [],
        previewVariants: importedPreviewVariants("stable-hokusai", null),
        providerUnavailable: {
          status: "unavailable",
          retainsNormalizedIr: true,
          nextOperation: "select-provider",
          selectableRendererVariantIds: [
            "stable-hokusai",
            ...(outlineCapabilities.length === 0 ? [] : ["stable-perfect-freehand"]),
          ],
          reason:
            "When the selected natural-media provider is unavailable, retain BrushProgramIR and mark the asset unavailable. A later provider selection is explicit and does not claim MYB visual parity.",
          limitations:
            outlineCapabilities.length === 0
              ? ["No independent provider option is currently available."]
              : ["Natural-media mixing, texture and dab dynamics require explicit provider selection."],
        },
        replacementCondition: {
          summary:
            "Replace the stable brush lane only after exact real-device strokes meet or exceed visual, pressure and explicit provider-selection gates for this material.",
          requiredEvidence: [
            "visual-equivalence",
            "real-device-stroke",
            "pressure-fidelity",
            "performance",
            "memory",
            "explicit-provider-selection",
            "soak",
          ],
        },
        marketplace: unlistedMarketplace("myb"),
        provenance: {
          ...provenanceBase,
          importer: "studio-format-gateway/importMybBrush",
          warnings: [],
          unmapped: [...unmappedSettings],
        },
      };
      break;
    }
    case "kpp": {
      const { program, unmapped, warnings } = input.result;
      const engineRequirements = deriveBrushEngineRequirements(program, "kpp");
      const normalizedReference = normalizedIrRef(
        program,
        "toonspectrum.brush-program-ir",
        "application/vnd.toonspectrum.brush-program+json",
      );
      const hokusaiCapabilities = engineRequirements.filter((capability) =>
        descriptorById("hokusai-natural-media").capabilities.includes(capability),
      );
      const outlineCapabilities = engineRequirements.filter((capability) =>
        descriptorById("perfect-freehand").capabilities.includes(capability),
      );
      const meshCapabilities = engineRequirements.filter((capability) =>
        descriptorById("google-ink-mesh").capabilities.includes(capability),
      );
      candidate = {
        ...base,
        kind: "brush-program",
        name: identity.name ?? program.name,
        engineRequirements,
        providerRequirements: deriveProviderRequirements(engineRequirements),
        sourceFormat: "kpp",
        contentDigest: computeAssetContentDigest(input.bytes),
        originalBlobRef: originalBlobRef(input.bytes, "image/png"),
        normalizedIrRef: normalizedReference,
        rendererVariants: [
          ...(meshCapabilities.length === 0
            ? []
            : [
                rendererVariant(
                  "stable-google-ink-mesh",
                  "stable",
                  "google-ink-mesh",
                  normalizedReference,
                  meshCapabilities,
                  [
                    "Mesh output consumes pre-modeled input; flow/opacity dynamics and stamp tips do not reach the mesh.",
                  ],
                ),
              ]),
          ...(hokusaiCapabilities.length === 0
            ? []
            : [
                rendererVariant(
                  "stable-hokusai",
                  "stable",
                  "hokusai-natural-media",
                  normalizedReference,
                  hokusaiCapabilities,
                  ["KPP parameters outside BrushProgramIR remain in provenance/sourcePayload."],
                ),
              ]),
          ...(outlineCapabilities.length === 0
            ? []
            : [
                rendererVariant(
                  "stable-perfect-freehand",
                  "stable",
                  "perfect-freehand",
                  normalizedReference,
                  outlineCapabilities,
                  ["Krita paint dynamics and natural-media mixing are not reproduced."],
                ),
              ]),
        ],
        realStrokePreviews: [],
        deviceProfiles: [],
        visualEquivalenceReport: null,
        dependencies: [],
        previewVariants: importedPreviewVariants(
          hokusaiCapabilities.length > 0
            ? "stable-hokusai"
            : meshCapabilities.length > 0
              ? "stable-google-ink-mesh"
              : null,
          null,
        ),
        providerUnavailable: {
          status: "unavailable",
          retainsNormalizedIr: true,
          nextOperation: "select-provider",
          selectableRendererVariantIds: [
            ...(meshCapabilities.length === 0 ? [] : ["stable-google-ink-mesh"]),
            ...(hokusaiCapabilities.length === 0 ? [] : ["stable-hokusai"]),
            ...(outlineCapabilities.length === 0 ? [] : ["stable-perfect-freehand"]),
          ],
          reason:
            "When the selected KPP provider is unavailable, retain BrushProgramIR and mark the asset unavailable. A later provider selection is explicit; no geometry or paint lane is substituted automatically.",
          limitations: [
            "An explicit provider selection does not claim Krita or CSP stroke equivalence.",
          ],
        },
        replacementCondition: {
          summary:
            "Replace this brush path only with real-device, pressure-fidelity and visual evidence over the same KPP corpus.",
          requiredEvidence: [
            "visual-equivalence",
            "real-device-stroke",
            "pressure-fidelity",
            "performance",
            "explicit-provider-selection",
            "soak",
          ],
        },
        marketplace: unlistedMarketplace("kpp"),
        provenance: {
          ...provenanceBase,
          importer: "studio-format-gateway/parseKppPreset",
          warnings: [...warnings],
          unmapped: [...unmapped],
        },
      };
      break;
    }
    case "svg": {
      const { scene, warnings, unsupported } = input.result;
      const engineRequirements = collectSceneFeatures(scene);
      const normalizedReference = normalizedIrRef(
        scene,
        "toonspectrum.scene-ir",
        "application/vnd.toonspectrum.scene+json",
      );
      candidate = {
        ...base,
        kind: "svg-decoration",
        name: identity.name ?? identity.id,
        // Scene-feature inventory IS the requirement list: exactly what the
        // planner will ask an adapter to honor for this decoration.
        engineRequirements,
        providerRequirements: deriveProviderRequirements(engineRequirements),
        sourceFormat: "svg",
        contentDigest: computeAssetContentDigest(input.svgText),
        originalBlobRef: originalBlobRef(input.svgText, "image/svg+xml"),
        normalizedIrRef: normalizedReference,
        rendererVariants: [
          rendererVariant(
            "stable-canvaskit",
            "stable",
            "skia-canvaskit",
            normalizedReference,
            engineRequirements,
            ["CanvasKit text requires an explicitly registered font asset."],
          ),
          rendererVariant(
            "studio-max-vello-gpu",
            "studio-max",
            "vello-gpu-browser",
            normalizedReference,
            engineRequirements,
            [
              "WebGPU availability is runtime-gated.",
              "This imported asset has no asset-specific visual-equivalence measurement yet.",
            ],
          ),
        ],
        realStrokePreviews: [],
        deviceProfiles: [],
        visualEquivalenceReport: null,
        dependencies: [],
        previewVariants: importedPreviewVariants(
          "stable-canvaskit",
          "studio-max-vello-gpu",
        ),
        providerUnavailable: {
          status: "unavailable",
          retainsNormalizedIr: true,
          nextOperation: "select-provider",
          selectableRendererVariantIds: ["stable-canvaskit", "studio-max-vello-gpu"],
          reason:
            "If the selected SVG provider is unavailable or fails its asset-specific gate, retain SceneIR and mark the asset unavailable. A later provider selection is explicit.",
          limitations: [
            "Unsupported SVG source features remain listed in provenance and are not reconstructed by a provider selection.",
          ],
        },
        replacementCondition: {
          summary:
            "Promote or replace the SVG renderer only after the same SceneIR passes visual equivalence, performance, memory, explicit provider-selection and soak gates.",
          requiredEvidence: [
            "visual-equivalence",
            "performance",
            "memory",
            "determinism",
            "explicit-provider-selection",
            "soak",
          ],
        },
        marketplace: unlistedMarketplace("svg"),
        provenance: {
          ...provenanceBase,
          importer: "studio-format-gateway/parseSvgToScene",
          warnings: [...warnings],
          unmapped: [...unsupported],
        },
      };
      break;
    }
  }
  return parseAssetMetadata(candidate);
}
