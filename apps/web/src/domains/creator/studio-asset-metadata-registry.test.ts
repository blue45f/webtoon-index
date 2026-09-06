import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { EngineCapabilityRegistry } from "@toonspectrum/studio-engine-registry";
import {
  UnknownAssetCapabilityError,
  brushProgramIRSchema,
  collectSceneFeatures,
  computeAssetContentDigest,
  computeAssetStructuredDigest,
} from "@toonspectrum/studio-project-model";
import { beforeAll, describe, expect, it } from "vitest";

import { parseKppPreset } from "../../../../../packages/studio-format-gateway/src/kpp";
import { importMybBrush } from "../../../../../packages/studio-format-gateway/src/myb";
import { parseSvgToScene } from "../../../../../packages/studio-format-gateway/src/svg";

import {
  STUDIO_ASSET_METADATA_CATALOG_KEY,
  STUDIO_ASSET_METADATA_KV_NAMESPACE,
  STUDIO_KNOWN_ENGINE_DESCRIPTORS,
  StudioAssetMetadataRegistry,
  StudioAssetMetadataRegistryError,
  deriveAssetMetadata,
  judgeAssetRenderability,
  studioAssetCapabilityVocabulary,
} from "./studio-asset-metadata-registry";
import { openStudioLocalDatabase } from "./studio-local-database";

import type {
  StudioLocalDatabase,
  StudioSqliteApiHandle,
} from "./studio-local-database";
import type { KppImportResult } from "../../../../../packages/studio-format-gateway/src/kpp";
import type { AssetMetadataIR } from "@toonspectrum/studio-project-model";

// ---------------------------------------------------------------------------
// Real fixtures — actual gateway parsers over the committed corpus files.
// ---------------------------------------------------------------------------

function corpusBytes(relative: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../../../../tests/corpus/${relative}`, import.meta.url)),
    ),
  );
}

const FIXED_NOW = 1_754_600_000_000;
const CORPUS_LICENSE = { spdx: "CC0-1.0", attribution: "ToonSpectrum corpus" };

const SVG_FIXTURE = `
  <svg width="120" height="80">
    <defs>
      <linearGradient id="tone" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#000"/>
        <stop offset="1" stop-color="#fff"/>
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="60" height="40" fill="url(#tone)"/>
    <circle cx="90" cy="40" r="20" fill="none" stroke="#123456" stroke-width="3"/>
  </svg>`;

function deriveMybCard(): AssetMetadataIR {
  const bytes = corpusBytes("brushes/myb/ink-crisp.myb");
  const result = importMybBrush(bytes, "brush-ink-crisp", "잉크 크리스프");
  return deriveAssetMetadata(
    { format: "myb", bytes, result },
    {
      id: "asset-myb-ink-crisp",
      license: CORPUS_LICENSE,
      sourceFileName: "ink-crisp.myb",
      now: () => FIXED_NOW,
    },
  );
}

function deriveKppCard(): AssetMetadataIR {
  const bytes = corpusBytes("brushes/kpp/paintbrush-ink-basic.kpp");
  const result = parseKppPreset(bytes);
  return deriveAssetMetadata(
    { format: "kpp", bytes, result },
    {
      id: "asset-kpp-ink-basic",
      license: CORPUS_LICENSE,
      sourceFileName: "paintbrush-ink-basic.kpp",
      now: () => FIXED_NOW,
    },
  );
}

/**
 * Synthetic vector-mesh brush program (Google Ink lane, V19 §2.3). No shipped
 * importer emits `google-ink-mesh` geometry today, so the fixture exercises
 * the derivation seam directly with a schema-parsed program.
 */
function deriveMeshCard(): AssetMetadataIR {
  const bytes = new TextEncoder().encode("synthetic-kpp-mesh-fixture");
  const program = brushProgramIRSchema.parse({
    id: "kpp:mesh-ink",
    name: "메시 잉크",
    geometry: { kind: "google-ink-mesh" },
    output: { target: "vector-mesh", bake: "editable-proxy" },
  });
  const result: KppImportResult = {
    program,
    unmapped: [],
    warnings: [],
    presetName: "메시 잉크",
  };
  return deriveAssetMetadata(
    { format: "kpp", bytes, result },
    {
      id: "asset-kpp-mesh-ink",
      license: CORPUS_LICENSE,
      sourceFileName: "mesh-ink.kpp",
      now: () => FIXED_NOW,
    },
  );
}

function deriveSvgCard(): AssetMetadataIR {
  const result = parseSvgToScene(SVG_FIXTURE);
  return deriveAssetMetadata(
    { format: "svg", svgText: SVG_FIXTURE, result },
    {
      id: "asset-svg-tone-panel",
      name: "톤 패널 장식",
      license: CORPUS_LICENSE,
      now: () => FIXED_NOW,
    },
  );
}

function engineSet(descriptorIds: readonly string[]): EngineCapabilityRegistry {
  const engines = EngineCapabilityRegistry.forTestFixtures();
  for (const id of descriptorIds) {
    const descriptor = STUDIO_KNOWN_ENGINE_DESCRIPTORS.find((d) => d.id === id);
    if (!descriptor) throw new Error(`unknown test descriptor id: ${id}`);
    engines.registerTestFixture(descriptor);
  }
  return engines;
}

const BASELINE_NO_WEBGPU = [
  "skia-canvaskit",
  "vello-cpu",
  "perfect-freehand",
  "hokusai-natural-media",
];

// ---------------------------------------------------------------------------
// Derivation (real wiring proof over the three gateway formats)
// ---------------------------------------------------------------------------

describe("deriveAssetMetadata", () => {
  it("derives a .myb brush card with natural-media requirements and loud-loss ledger", () => {
    const bytes = corpusBytes("brushes/myb/ink-crisp.myb");
    const result = importMybBrush(bytes, "brush-ink-crisp", "잉크 크리스프");
    const card = deriveMybCard();
    expect(card.kind).toBe("brush-program");
    expect(card.sourceFormat).toBe("myb");
    expect(card.name).toBe("잉크 크리스프");
    expect(card.engineRequirements).toEqual([
      "brush.natural-media.dynamics",
      "brush.natural-media.myb",
      "stroke.geometry.pressure-outline",
    ]);
    expect(card.contentDigest).toBe(computeAssetContentDigest(bytes));
    expect(card.originalBlobRef).toEqual({
      digest: card.contentDigest,
      byteLength: bytes.byteLength,
      mediaType: "application/json",
      locator: null,
    });
    expect(card.normalizedIrRef).toEqual({
      digest: computeAssetStructuredDigest(result.preset),
      schema: "toonspectrum.brush-program-ir",
      schemaVersion: 11,
      mediaType: "application/vnd.toonspectrum.brush-program+json",
      locator: null,
    });
    expect(card.providerRequirements).toEqual([
      {
        capability: "brush.natural-media.dynamics",
        providerIds: ["hokusai-natural-media"],
        versionRange: null,
        optional: false,
        reason: "Normalized IR requires brush.natural-media.dynamics.",
      },
      {
        capability: "brush.natural-media.myb",
        providerIds: ["hokusai-natural-media"],
        versionRange: null,
        optional: false,
        reason: "Normalized IR requires brush.natural-media.myb.",
      },
      {
        capability: "stroke.geometry.pressure-outline",
        providerIds: ["perfect-freehand"],
        versionRange: null,
        optional: false,
        reason: "Normalized IR requires stroke.geometry.pressure-outline.",
      },
    ]);
    expect(card.rendererVariants.map(({ id, qualityStatus }) => ({ id, qualityStatus }))).toEqual([
      { id: "stable-hokusai", qualityStatus: "unmeasured" },
      { id: "stable-perfect-freehand", qualityStatus: "unmeasured" },
    ]);
    expect(card.realStrokePreviews).toEqual([]);
    expect(card.deviceProfiles).toEqual([]);
    expect(card.visualEquivalenceReport).toBeNull();
    expect(card.previewVariants.stable).toMatchObject({
      status: "not-generated",
      artifactRef: null,
      rendererVariantId: "stable-hokusai",
    });
    expect(card.previewVariants.studioMax).toMatchObject({
      status: "not-generated",
      artifactRef: null,
      rendererVariantId: null,
    });
    expect(card.providerUnavailable).toMatchObject({
      status: "unavailable",
      retainsNormalizedIr: true,
      nextOperation: "select-provider",
      selectableRendererVariantIds: ["stable-hokusai", "stable-perfect-freehand"],
    });
    expect(card.replacementCondition?.requiredEvidence).toContain("real-device-stroke");
    expect(card.marketplace).toMatchObject({
      status: "not-listed",
      listingId: null,
      publisherId: null,
      commercialUseAllowed: null,
    });
    expect(card.provenance.importer).toBe("studio-format-gateway/importMybBrush");
    // Every setting the common IR does NOT carry survives into provenance — zero silent loss.
    // Settings the IR does carry (hardness → tip.hardness since 66bc25b4, dabs_per_actual_radius →
    // tip.spacingPct) must stay out of the ledger; provider-native settings the vector lane
    // still ignores (anti_aliasing, pressure_gain_log) stay in it.
    expect(card.provenance.unmapped).toEqual(result.unmappedSettings);
    expect(card.provenance.unmapped).toContain("pressure_gain_log");
    expect(card.provenance.unmapped).toContain("anti_aliasing");
    expect(card.provenance.unmapped).not.toContain("hardness");
    expect(card.provenance.unmapped).not.toContain("dabs_per_actual_radius");
    expect(card.createdAt).toBe(FIXED_NOW);
  });

  it("derives a .kpp paintbrush card preserving importer warnings and unmapped params", () => {
    const bytes = corpusBytes("brushes/kpp/paintbrush-ink-basic.kpp");
    const result = parseKppPreset(bytes);
    const card = deriveKppCard();
    expect(card.kind).toBe("brush-program");
    expect(card.sourceFormat).toBe("kpp");
    expect(card.name).toBe(result.presetName);
    // Krita paintbrush lane prefers hokusai → natural-media dynamics required.
    expect(card.engineRequirements).toEqual([
      "brush.natural-media.dynamics",
      "stroke.geometry.pressure-outline",
    ]);
    expect(card.contentDigest).toBe(computeAssetContentDigest(bytes));
    expect(card.originalBlobRef).toMatchObject({
      digest: card.contentDigest,
      byteLength: bytes.byteLength,
      mediaType: "image/png",
      locator: null,
    });
    expect(card.normalizedIrRef?.digest).toBe(
      computeAssetStructuredDigest(result.program),
    );
    expect(card.rendererVariants.every((variant) => variant.qualityStatus === "unmeasured")).toBe(
      true,
    );
    expect(card.previewVariants.stable?.status).toBe("not-generated");
    expect(card.previewVariants.studioMax?.status).toBe("not-generated");
    expect(card.visualEquivalenceReport).toBeNull();
    expect(card.providerUnavailable?.limitations).toContain(
      "An explicit provider selection does not claim Krita or CSP stroke equivalence.",
    );
    expect(card.marketplace?.status).toBe("not-listed");
    expect(card.provenance.warnings).toEqual(result.warnings);
    expect(card.provenance.unmapped).toEqual(result.unmapped);
  });

  it("derives a vector-mesh brush card requiring the google-ink-mesh lane, fail-closed", () => {
    const card = deriveMeshCard();
    expect(card.kind).toBe("brush-program");
    expect(card.name).toBe("메시 잉크");
    // The mesh token is the only requirement — never the outline lane's
    // pressure-outline token, so no host can satisfy it with perfect-freehand.
    expect(card.engineRequirements).toEqual(["stroke.geometry.ink-mesh"]);
    expect(card.providerRequirements).toEqual([
      {
        capability: "stroke.geometry.ink-mesh",
        providerIds: ["google-ink-mesh"],
        versionRange: null,
        optional: false,
        reason: "Normalized IR requires stroke.geometry.ink-mesh.",
      },
    ]);
    expect(
      card.rendererVariants.map(({ id, tier, providerId, qualityStatus }) => ({
        id,
        tier,
        providerId,
        qualityStatus,
      })),
    ).toEqual([
      {
        id: "stable-google-ink-mesh",
        tier: "stable",
        providerId: "google-ink-mesh",
        qualityStatus: "unmeasured",
      },
    ]);
    expect(card.previewVariants.stable).toMatchObject({
      status: "not-generated",
      rendererVariantId: "stable-google-ink-mesh",
    });
    // Fail-closed: an unavailable mesh provider preserves BrushProgramIR and
    // offers its provider only as a later, explicit selection.
    expect(card.providerUnavailable).toMatchObject({
      status: "unavailable",
      retainsNormalizedIr: true,
      nextOperation: "select-provider",
      selectableRendererVariantIds: ["stable-google-ink-mesh"],
    });
    expect(card.visualEquivalenceReport).toBeNull();
  });

  it("derives an SVG decoration card whose requirements are exactly the scene features", () => {
    const result = parseSvgToScene(SVG_FIXTURE);
    const card = deriveSvgCard();
    expect(card.kind).toBe("svg-decoration");
    expect(card.sourceFormat).toBe("svg");
    expect(card.engineRequirements).toEqual(collectSceneFeatures(result.scene));
    expect(card.engineRequirements).toEqual([
      "render.vector.fill",
      "render.vector.gradient",
      "render.vector.stroke",
    ]);
    expect(card.contentDigest).toBe(computeAssetContentDigest(SVG_FIXTURE));
    expect(card.originalBlobRef).toEqual({
      digest: card.contentDigest,
      byteLength: new TextEncoder().encode(SVG_FIXTURE).byteLength,
      mediaType: "image/svg+xml",
      locator: null,
    });
    expect(card.normalizedIrRef).toEqual({
      digest: computeAssetStructuredDigest(result.scene),
      schema: "toonspectrum.scene-ir",
      schemaVersion: 11,
      mediaType: "application/vnd.toonspectrum.scene+json",
      locator: null,
    });
    expect(card.rendererVariants.map(({ id, tier, qualityStatus }) => ({
      id,
      tier,
      qualityStatus,
    }))).toEqual([
      { id: "stable-canvaskit", tier: "stable", qualityStatus: "unmeasured" },
      {
        id: "studio-max-vello-gpu",
        tier: "studio-max",
        qualityStatus: "unmeasured",
      },
    ]);
    expect(card.previewVariants.stable).toMatchObject({
      status: "not-generated",
      artifactRef: null,
      rendererVariantId: "stable-canvaskit",
    });
    expect(card.previewVariants.studioMax).toMatchObject({
      status: "not-generated",
      artifactRef: null,
      rendererVariantId: "studio-max-vello-gpu",
    });
    expect(card.visualEquivalenceReport).toBeNull();
    expect(card.providerUnavailable).toMatchObject({
      status: "unavailable",
      retainsNormalizedIr: true,
      nextOperation: "select-provider",
      selectableRendererVariantIds: ["stable-canvaskit", "studio-max-vello-gpu"],
    });
    expect(card.marketplace).toMatchObject({
      status: "not-listed",
      tags: ["svg"],
    });
    expect(card.provenance.importer).toBe("studio-format-gateway/parseSvgToScene");
  });

  it("only names providers that actually declare each derived capability", () => {
    for (const card of [
      deriveMybCard(),
      deriveKppCard(),
      deriveMeshCard(),
      deriveSvgCard(),
    ]) {
      expect(card.providerRequirements.map((requirement) => requirement.capability)).toEqual(
        card.engineRequirements,
      );
      for (const requirement of card.providerRequirements) {
        expect(requirement.providerIds.length).toBeGreaterThan(0);
        for (const providerId of requirement.providerIds) {
          const descriptor = STUDIO_KNOWN_ENGINE_DESCRIPTORS.find(
            (candidate) => candidate.id === providerId,
          );
          expect(descriptor?.capabilities).toContain(requirement.capability);
        }
      }
      expect(card.rendererVariants.every((variant) => variant.qualityStatus === "unmeasured")).toBe(
        true,
      );
      expect(card.realStrokePreviews).toEqual([]);
      expect(card.deviceProfiles).toEqual([]);
      expect(card.visualEquivalenceReport).toBeNull();
      expect(card.providerUnavailable).toMatchObject({
        status: "unavailable",
        retainsNormalizedIr: true,
        nextOperation: "select-provider",
      });
      expect(card.replacementCondition?.requiredEvidence).toContain(
        "explicit-provider-selection",
      );
    }
  });

  it("is deterministic: same payload + clock produces an identical card, changed bytes change the digest", () => {
    expect(deriveMybCard()).toEqual(deriveMybCard());
    const bytes = corpusBytes("brushes/myb/ink-crisp.myb");
    const tampered = new Uint8Array(bytes);
    // Flip a byte inside the JSON comment (stays parseable, different content).
    const offset = new TextDecoder().decode(bytes).indexOf("Crisp");
    tampered[offset] = 0x58; // "X"
    const result = importMybBrush(tampered, "brush-ink-crisp", "잉크 크리스프");
    const card = deriveAssetMetadata(
      { format: "myb", bytes: tampered, result },
      {
        id: "asset-myb-ink-crisp",
        license: CORPUS_LICENSE,
        sourceFileName: "ink-crisp.myb",
        now: () => FIXED_NOW,
      },
    );
    expect(card.contentDigest).not.toBe(deriveMybCard().contentDigest);
  });
});

// ---------------------------------------------------------------------------
// Registry: register / lookup / vocabulary gate
// ---------------------------------------------------------------------------

describe("StudioAssetMetadataRegistry", () => {
  it("registers derived cards and lists them by kind in stable id order", () => {
    const registry = new StudioAssetMetadataRegistry();
    registry.register(deriveSvgCard());
    registry.register(deriveMybCard());
    registry.register(deriveKppCard());
    expect(registry.get("asset-myb-ink-crisp")?.sourceFormat).toBe("myb");
    expect(registry.get("no-such-asset")).toBeNull();
    expect(registry.list().map((a) => a.id)).toEqual([
      "asset-kpp-ink-basic",
      "asset-myb-ink-crisp",
      "asset-svg-tone-panel",
    ]);
    expect(registry.list("brush-program").map((a) => a.id)).toEqual([
      "asset-kpp-ink-basic",
      "asset-myb-ink-crisp",
    ]);
    expect(registry.list("svg-decoration").map((a) => a.id)).toEqual([
      "asset-svg-tone-panel",
    ]);
  });

  it("rejects duplicate ids loudly", () => {
    const registry = new StudioAssetMetadataRegistry();
    registry.register(deriveMybCard());
    expect(() => registry.register(deriveMybCard())).toThrow(
      StudioAssetMetadataRegistryError,
    );
  });

  it("rejects capability tokens outside the engine vocabulary", () => {
    const registry = new StudioAssetMetadataRegistry();
    const rogue = {
      ...deriveSvgCard(),
      id: "asset-rogue",
      engineRequirements: ["render.hologram.field"],
      // Exercise the legacy capability view: the schema lifts this single
      // token into providerRequirements before the registry vocabulary gate.
      providerRequirements: undefined,
    };
    expect(() => registry.register(rogue)).toThrow(UnknownAssetCapabilityError);
    // A rejected card must not be queryable (no partial registration).
    expect(registry.get("asset-rogue")).toBeNull();
  });

  it("builds its vocabulary from shipped descriptors plus scene features", () => {
    const vocabulary = studioAssetCapabilityVocabulary();
    for (const token of [
      "render.vector.fill",
      "render.gpu.webgpu",
      "render.lottie.frame",
      "render.svg.vello-native",
      "format.svg.strict-audit",
      "brush.natural-media.myb",
      "stroke.geometry.pressure-outline",
      "stroke.geometry.ink-mesh",
      "stroke.geometry.incremental-mesh-delta",
      "filter.op.gaussian-blur",
      "render.blend.multiply",
    ]) {
      expect(vocabulary.has(token)).toBe(true);
    }
    expect(vocabulary.has("render.hologram.field")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Renderability against the current engine set
// ---------------------------------------------------------------------------

describe("renderability judgment", () => {
  it("marks a vello-gpu-browser material unfulfilled on a WebGPU-absent engine set", () => {
    const registry = new StudioAssetMetadataRegistry();
    registry.register({
      id: "asset-velato-sparkle",
      kind: "lottie-effect",
      name: "벨라토 스파클",
      version: "1.0.0",
      engineRequirements: ["render.gpu.webgpu", "render.lottie.frame"],
      sourceFormat: "lottie",
      license: { spdx: "MIT" },
      contentDigest: computeAssetContentDigest("velato-fixture"),
      createdAt: FIXED_NOW,
      provenance: { importer: "marketplace/pack-import", importedAt: FIXED_NOW },
    });

    const withoutWebGpu = registry.judgeRenderability(
      "asset-velato-sparkle",
      engineSet(BASELINE_NO_WEBGPU),
    );
    expect(withoutWebGpu.renderable).toBe(false);
    expect(withoutWebGpu.missingCapabilities).toEqual([
      "render.gpu.webgpu",
      "render.lottie.frame",
    ]);
    expect(withoutWebGpu.capabilityProviders["render.gpu.webgpu"]).toEqual([]);

    const withWebGpu = registry.judgeRenderability(
      "asset-velato-sparkle",
      engineSet([...BASELINE_NO_WEBGPU, "vello-gpu-browser"]),
    );
    expect(withWebGpu.renderable).toBe(true);
    expect(withWebGpu.missingCapabilities).toEqual([]);
    expect(withWebGpu.capabilityProviders["render.gpu.webgpu"]).toEqual([
      "vello-gpu-browser",
    ]);
  });

  it("judges derived cards: svg renders on the vector baseline, myb needs the hokusai lane", () => {
    const svgReport = judgeAssetRenderability(
      deriveSvgCard(),
      engineSet(["skia-canvaskit", "vello-cpu"]),
    );
    expect(svgReport.renderable).toBe(true);
    expect(svgReport.capabilityProviders["render.vector.gradient"]).toEqual([
      "skia-canvaskit",
      "vello-cpu",
    ]);

    const mybWithoutHokusai = judgeAssetRenderability(
      deriveMybCard(),
      engineSet(["skia-canvaskit", "vello-cpu", "perfect-freehand"]),
    );
    expect(mybWithoutHokusai.renderable).toBe(false);
    expect(mybWithoutHokusai.missingCapabilities).toEqual([
      "brush.natural-media.dynamics",
      "brush.natural-media.myb",
    ]);

    const mybFull = judgeAssetRenderability(
      deriveMybCard(),
      engineSet(BASELINE_NO_WEBGPU),
    );
    expect(mybFull.renderable).toBe(true);
  });

  it("judges a vector-mesh card unrenderable without the google-ink-mesh lane (no silent outline substitution)", () => {
    const withoutMesh = judgeAssetRenderability(
      deriveMeshCard(),
      engineSet(BASELINE_NO_WEBGPU),
    );
    expect(withoutMesh.renderable).toBe(false);
    expect(withoutMesh.missingCapabilities).toEqual(["stroke.geometry.ink-mesh"]);
    // perfect-freehand is registered but must NOT satisfy the mesh token.
    expect(withoutMesh.capabilityProviders["stroke.geometry.ink-mesh"]).toEqual([]);

    const withMesh = judgeAssetRenderability(
      deriveMeshCard(),
      engineSet([...BASELINE_NO_WEBGPU, "google-ink-mesh"]),
    );
    expect(withMesh.renderable).toBe(true);
    expect(withMesh.missingCapabilities).toEqual([]);
    expect(withMesh.capabilityProviders["stroke.geometry.ink-mesh"]).toEqual([
      "google-ink-mesh",
    ]);
  });

  it("refuses to judge an unregistered asset id", () => {
    const registry = new StudioAssetMetadataRegistry();
    expect(() =>
      registry.judgeRenderability("ghost", engineSet(BASELINE_NO_WEBGPU)),
    ).toThrow(StudioAssetMetadataRegistryError);
  });
});

// ---------------------------------------------------------------------------
// SQLite kv persistence (real sqlite-wasm :memory: DB — no stub semantics)
// ---------------------------------------------------------------------------

describe("SQLite kv persistence", () => {
  let sqlite3: StudioSqliteApiHandle;

  beforeAll(async () => {
    const module = await import("@sqlite.org/sqlite-wasm");
    sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
  });

  async function openMemoryDatabase(): Promise<StudioLocalDatabase> {
    return openStudioLocalDatabase({
      vfs: "memory",
      loadSqlite: () => Promise.resolve(sqlite3),
    });
  }

  it("round-trips the catalog through the asset-metadata kv namespace", async () => {
    const database = await openMemoryDatabase();
    try {
      const store = database.asAsyncKeyValueStore(STUDIO_ASSET_METADATA_KV_NAMESPACE);
      const registry = new StudioAssetMetadataRegistry();
      registry.register(deriveMybCard());
      registry.register(deriveKppCard());
      registry.register(deriveSvgCard());
      await registry.saveTo(store);

      // The snapshot lives in the shared kv table under the dedicated
      // namespace — no new tables, no migration.
      const raw = await database.kvGet(
        STUDIO_ASSET_METADATA_KV_NAMESPACE,
        STUDIO_ASSET_METADATA_CATALOG_KEY,
      );
      expect(raw).not.toBeNull();

      const loaded = await StudioAssetMetadataRegistry.loadFrom(store);
      expect(loaded.list()).toEqual(registry.list());

      // Saving the loaded registry again is byte-identical (canonical JSON).
      await loaded.saveTo(store);
      expect(
        await database.kvGet(
          STUDIO_ASSET_METADATA_KV_NAMESPACE,
          STUDIO_ASSET_METADATA_CATALOG_KEY,
        ),
      ).toBe(raw);
    } finally {
      await database.close();
    }
  });

  it("loads a catalog snapshot written by the pre-0520c7e1 release (retired fallback spellings)", async () => {
    // Reconstruct exactly what the previous release persisted: no `providerUnavailable`
    // key, a top-level `fallback: null`, and `requiredEvidence` still naming the retired
    // `fallback` gate. Catalog key and revision were unchanged across that release, so this
    // snapshot passes the revision check and every card must migrate — one rejected card
    // would poison the whole (intentionally non-partial) load.
    const database = await openMemoryDatabase();
    try {
      const store = database.asAsyncKeyValueStore(STUDIO_ASSET_METADATA_KV_NAMESPACE);
      const current = [deriveMybCard(), deriveKppCard(), deriveSvgCard()];
      const legacyAssets = current.map((card) => {
        const { providerUnavailable, ...rest } = card;
        const firstVariantId = providerUnavailable?.selectableRendererVariantIds[0] ?? null;
        const firstVariant = rest.rendererVariants.find((variant) => variant.id === firstVariantId);
        return {
          ...rest,
          // The retired automatic instruction the previous release wrote next to the evidence.
          fallback: providerUnavailable === null
            ? null
            : {
                strategy: "renderer-variant",
                rendererVariantId: firstVariantId,
                providerId: firstVariant?.providerId ?? null,
                preservesNormalizedIr: providerUnavailable.retainsNormalizedIr,
                reason: "Legacy automatic renderer substitution.",
                limitations: providerUnavailable.limitations,
              },
          replacementCondition: rest.replacementCondition === null
            ? null
            : {
                ...rest.replacementCondition,
                requiredEvidence: rest.replacementCondition.requiredEvidence.map((token) =>
                  token === "explicit-provider-selection" ? "fallback" : token,
                ),
              },
        };
      });
      expect(
        legacyAssets.some((asset) =>
          asset.replacementCondition?.requiredEvidence.includes("fallback"),
        ),
      ).toBe(true);
      expect(legacyAssets.some((asset) => asset.fallback !== null)).toBe(true);
      await store.set(
        STUDIO_ASSET_METADATA_CATALOG_KEY,
        JSON.stringify({ revision: 1, assets: legacyAssets }),
      );

      const loaded = await StudioAssetMetadataRegistry.loadFrom(store);
      expect(loaded.list().map((asset) => asset.id).sort()).toEqual(
        current.map((asset) => asset.id).sort(),
      );
      for (const asset of loaded.list()) {
        expect(asset).not.toHaveProperty("fallback");
        expect(asset.replacementCondition?.requiredEvidence ?? []).not.toContain("fallback");
      }
      // Everything except the migration-authored `providerUnavailable.reason` text is the same
      // canonical card the current derivers produce; the routing facts inside it match too.
      for (const card of current) {
        const migrated = loaded.get(card.id);
        expect(migrated).not.toBeNull();
        const { providerUnavailable: migratedUnavailable, ...migratedRest } = migrated!;
        const { providerUnavailable: currentUnavailable, ...currentRest } = card;
        expect(migratedRest).toEqual(currentRest);
        if (currentUnavailable === null) {
          expect(migratedUnavailable).toBeNull();
        } else {
          expect(migratedUnavailable).toMatchObject({
            status: "unavailable",
            retainsNormalizedIr: currentUnavailable.retainsNormalizedIr,
            nextOperation: "select-provider",
            selectableRendererVariantIds: currentUnavailable.selectableRendererVariantIds,
            limitations: currentUnavailable.limitations,
          });
        }
      }
      // Saving the migrated catalog rewrites it in the current spelling; reloading and saving
      // again must reproduce the exact same bytes (canonical JSON, no retired spellings left).
      await loaded.saveTo(store);
      const rewrittenPayload = await store.get(STUDIO_ASSET_METADATA_CATALOG_KEY);
      expect(rewrittenPayload).not.toBeNull();
      expect(rewrittenPayload).not.toContain('"fallback"');
      const reloaded = await StudioAssetMetadataRegistry.loadFrom(store);
      expect(reloaded.list()).toEqual(loaded.list());
      await reloaded.saveTo(store);
      expect(await store.get(STUDIO_ASSET_METADATA_CATALOG_KEY)).toBe(rewrittenPayload);
    } finally {
      await database.close();
    }
  });

  it("loads an empty registry when no snapshot exists, and fails loudly on corruption", async () => {
    const database = await openMemoryDatabase();
    try {
      const store = database.asAsyncKeyValueStore(STUDIO_ASSET_METADATA_KV_NAMESPACE);
      const empty = await StudioAssetMetadataRegistry.loadFrom(store);
      expect(empty.list()).toEqual([]);

      await store.set(STUDIO_ASSET_METADATA_CATALOG_KEY, "{not json");
      await expect(StudioAssetMetadataRegistry.loadFrom(store)).rejects.toThrow(
        /not valid JSON/,
      );

      await store.set(
        STUDIO_ASSET_METADATA_CATALOG_KEY,
        JSON.stringify({ revision: 999, assets: [] }),
      );
      await expect(StudioAssetMetadataRegistry.loadFrom(store)).rejects.toThrow(
        StudioAssetMetadataRegistryError,
      );

      // A snapshot with an invalid entry refuses to load partially.
      await store.set(
        STUDIO_ASSET_METADATA_CATALOG_KEY,
        JSON.stringify({ revision: 1, assets: [{ id: "broken" }] }),
      );
      await expect(StudioAssetMetadataRegistry.loadFrom(store)).rejects.toThrow();
    } finally {
      await database.close();
    }
  });
});
