import { describe, expect, it } from "vitest";

import {
  resolveStudioHokusaiProductLiveAdmission,
} from "../brush/studio-brush-backend-quality-policy";
import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "../brush/studio-brush-pack-index";
import { materializeAllStudioBrushPackSelections } from "../brush/studio-brush-pack-runtime";
import { BRUSH_PRESETS } from "../studio-brush";

import {
  STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
  type StudioHokusaiLiveBrushCapabilities,
} from "./studio-hokusai-live-brush-protocol";
import {
  STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY,
  STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY_VERSION,
  STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE,
  resolveStudioHokusaiLiveAutoRouteDecision,
  resolveStudioHokusaiLiveRoute,
} from "./studio-hokusai-live-brush-router";
import {
  planStudioHokusaiNaturalMediaRender,
  type StudioHokusaiMaterialProfileId,
  type StudioHokusaiNaturalMediaPresetId,
} from "./studio-hokusai-natural-media-contract";
import {
  studioHokusaiNaturalMediaPresetSettings,
} from "./studio-hokusai-natural-media-presets";
import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
} from "./studio-hokusai-natural-media-worker-protocol";

import type { DrawEl } from "../studio-element-model";

const EXPECTED_CORE_AUTO_ROUTE = new Map<string, StudioHokusaiNaturalMediaPresetId>([
  ["pencil", "pencil"],
  ["pencil-2b", "pencil"],
  ["pencil-6b", "pencil"],
  ["soft-pencil", "pencil"],
  ["colored-pencil", "pencil"],
  ["erodible-pencil", "pencil"],
  ["pencil-grain", "pencil"],
  ["charcoal", "charcoal"],
  ["chalk", "charcoal"],
  ["crayon", "charcoal"],
  ["dry-media", "charcoal"],
  ["pastel", "charcoal"],
  ["oil-pastel", "charcoal"],
  ["oil", "oil"],
  ["acrylic", "oil"],
  ["paint-tube", "oil"],
  ["gouache", "oil"],
  ["brush", "oil"],
  ["flat-brush", "oil"],
  ["calligraphy", "calligraphy"],
  ["fountain-pen", "calligraphy"],
  ["parallel-pen", "calligraphy"],
  ["brush-pen", "calligraphy"],
  ["marker", "marker"],
  ["felt-tip", "marker"],
  ["marker-bold", "marker"],
  ["alcohol-marker", "marker"],
  ["highlighter", "marker"],
  ["chisel-highlighter", "marker"],
  ["pastel-highlighter", "marker"],
]);
const EXPECTED_CORE_MATERIAL_PROFILE = new Map<string, StudioHokusaiMaterialProfileId>([
  ...[...EXPECTED_CORE_AUTO_ROUTE.keys()]
    .filter((identity) => EXPECTED_CORE_AUTO_ROUTE.get(identity) === "pencil")
    .map((identity) => [identity, "pencil" as const] as const),
  ["charcoal", "charcoal"],
  ["chalk", "chalk"],
  ["crayon", "crayon"],
  ["dry-media", "charcoal"],
  ["pastel", "pastel"],
  ["oil-pastel", "oil-pastel"],
  ["oil", "oil"],
  ["acrylic", "acrylic"],
  ["paint-tube", "painterly"],
  ["gouache", "gouache"],
  ["brush", "painterly"],
  ["flat-brush", "painterly"],
  ...[...EXPECTED_CORE_AUTO_ROUTE.keys()]
    .filter((identity) => EXPECTED_CORE_AUTO_ROUTE.get(identity) === "calligraphy")
    .map((identity) => [identity, "calligraphy" as const] as const),
  ...[...EXPECTED_CORE_AUTO_ROUTE.keys()]
    .filter((identity) => EXPECTED_CORE_AUTO_ROUTE.get(identity) === "marker")
    .map((identity) => [identity, "marker" as const] as const),
]);

const CAPABILITIES: StudioHokusaiLiveBrushCapabilities = {
  engine: "reearth-hokusai",
  engineVersion: "0.3.0",
  surfaceAdapterVersion: STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
  liveAdapterVersion: STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
  wasm: true,
  dedicatedWorker: true,
  packedDirtyFrames: true,
  transferableFrames: true,
  epochCancellation: true,
  canonicalPng: true,
  liveCommitParityReceipt: true,
  materialTexture: "studio-hokusai-material-texture-v2",
  materialProfileRouting: "identity-profile-v1",
  endpointPolicy: "tapered-start-no-dab-carrier-v1",
  mainThreadFullFrameCopy: false,
};

function stableSeed(identity: string): number {
  let seed = 0x811c_9dc5;
  for (const character of identity) {
    seed ^= character.codePointAt(0) ?? 0;
    seed = Math.imul(seed, 0x0100_0193) >>> 0;
  }
  return seed;
}

function stableColor(index: number): `#${string}` {
  const red = (0x25 + index * 23) & 0xff;
  const green = (0x47 + index * 37) & 0xff;
  const blue = (0x69 + index * 53) & 0xff;
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}` as `#${string}`;
}

function sourceStroke(
  brushId: string,
  width: number,
  color: `#${string}`,
): DrawEl {
  return {
    id: `hokusai-policy-${brushId}`,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [80, 100, 140, 112, 210, 96, 280, 108],
    pressures: [0.2, 0.45, 0.7, 0.9],
    stroke: color,
    strokeWidth: width,
    opacity: 1,
    brush: brushId,
  };
}

describe("Studio Hokusai auto-route catalogue quality policy", () => {
  it("keeps the small-pencil pressure core continuous instead of sub-pixel collapsing", () => {
    const pencil = studioHokusaiNaturalMediaPresetSettings("pencil");
    expect(pencil.dabs_per_actual_radius?.base_value).toBeGreaterThanOrEqual(9);
    expect(pencil.opaque?.base_value).toBeGreaterThanOrEqual(0.95);
    expect(pencil.radius_logarithmic?.inputs.pressure).toEqual([
      [0, -0.82],
      [0.15, -0.48],
      [0.35, -0.22],
      [0.55, -0.04],
      [0.8, 0.12],
      [1, 0.24],
    ]);
  });

  it("audits all 234 identities and never promotes a procedural carrier as charcoal", () => {
    const professional = materializeAllStudioBrushPackSelections();
    const identities = [
      ...BRUSH_PRESETS.map((preset) => ({
        source: "core" as const,
        catalogId: preset.id,
        runtimeBrushId: preset.id,
      })),
      ...professional.map((selection) => ({
        source: "pro" as const,
        catalogId: selection.catalogId,
        runtimeBrushId: selection.runtimeBrushId,
      })),
    ];
    expect(identities).toHaveLength(BRUSH_PRESETS.length + professional.length);
    expect(STUDIO_BRUSH_PACK_DESCRIPTORS).toHaveLength(professional.length);
    expect(new Set(identities.map(({ catalogId }) => catalogId))).toHaveLength(
      BRUSH_PRESETS.length + professional.length,
    );

    const admitted = identities.filter(({ catalogId, runtimeBrushId }) => (
      resolveStudioHokusaiLiveAutoRouteDecision(runtimeBrushId, catalogId).status
        === "admitted"
    ));
    expect(new Set(admitted.map(({ catalogId }) => catalogId))).toEqual(
      new Set(EXPECTED_CORE_AUTO_ROUTE.keys()),
    );
    expect(admitted.every(({ source }) => source === "core")).toBe(true);

    const sharedDryMediaCarriers = identities.filter(({ source, runtimeBrushId }) => (
      source === "pro" && runtimeBrushId === "dry-media"
    ));
    expect(sharedDryMediaCarriers.length).toBeGreaterThan(20);
    for (const identity of sharedDryMediaCarriers) {
      expect(resolveStudioHokusaiLiveAutoRouteDecision(
        identity.runtimeBrushId,
        identity.catalogId,
      )).toEqual({
        status: "rejected",
        reason: "catalog-identity-not-quality-gated",
      });
    }
  });

  it("preserves every admitted core preset's width, opacity, color and seed in both contracts", () => {
    const eligiblePresets = BRUSH_PRESETS.filter(({ id }) => (
      EXPECTED_CORE_AUTO_ROUTE.has(id)
    ));
    expect(eligiblePresets).toHaveLength(EXPECTED_CORE_AUTO_ROUTE.size);

    for (const [index, preset] of eligiblePresets.entries()) {
      const presetId = EXPECTED_CORE_AUTO_ROUTE.get(preset.id)!;
      const materialProfileId = EXPECTED_CORE_MATERIAL_PROFILE.get(preset.id)!;
      const color = (preset.defaultColor ?? stableColor(index)) as `#${string}`;
      const seed = stableSeed(preset.id);
      const route = resolveStudioHokusaiLiveRoute({
        brushId: preset.id,
        catalogId: preset.id,
        documentWidth: 1_440,
        documentHeight: 8_000,
        firstX: 180,
        firstY: 1_200,
        radiusPixels: preset.defaultWidth,
        color,
        opacity: preset.defaultOpacity,
        seed,
        providerState: "ready",
        capabilities: CAPABILITIES,
      });
      expect(route.status, preset.id).toBe("ready");
      if (route.status !== "ready") continue;
      expect(route.presetId).toBe(presetId);
      expect(route.config).toMatchObject({
        presetId,
        materialProfileId,
        radiusPixels: preset.defaultWidth,
        opacity: preset.defaultOpacity,
        color,
        seed,
      });
      expect(route.autoRoutePolicy).toEqual({
        version: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY_VERSION,
        qualityGate: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE,
        identity: preset.id,
        identityAuthority: "catalog-id",
      });

      const planned = planStudioHokusaiNaturalMediaRender(
        sourceStroke(preset.id, preset.defaultWidth, color),
        {
          presetId,
          materialProfileId,
          color,
          sizeScale: 1,
          opacity: preset.defaultOpacity,
          seed,
        },
        { width: 1_440, height: 8_000 },
      );
      expect(planned.ok, preset.id).toBe(true);
      if (!planned.ok) continue;
      expect(planned.plan).toMatchObject({
        presetId,
        materialProfileId,
        color,
        opacity: preset.defaultOpacity,
        seed,
        raster: { radiusPixels: preset.defaultWidth },
      });
    }
  });

  it("routes the calligraphy and marker specialists through the same evidence gate", () => {
    expect(STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY.qualityGate).toEqual({
      id: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE,
      admittedPresets: ["pencil", "charcoal", "oil", "calligraphy", "marker"],
      requiredEvidence: [
        "real-wasm-visible-output",
        "deterministic-seed-replay",
        "pressure-response",
        "exact-live-commit-receipt",
        "catalog-default-config-snapshot",
        "identity-specific-material-profile",
      ],
    });
    // The eleven specialists that used to sit in `withheldSpecialistIdentities`. They cleared the
    // unchanged six-part gate in scripts/verify-studio-hokusai-live-brush.mjs (same texture,
    // edge-density, anti-circle-carrier and centreline thresholds as the original three) and all
    // five families produce distinct settled pixel hashes, so they now paint with the real WASM
    // engine instead of the procedural specialist fallback.
    const specialists = [
      ["calligraphy", "fountain-pen", "parallel-pen", "brush-pen"],
      ["marker", "felt-tip", "marker-bold", "alcohol-marker", "highlighter",
        "chisel-highlighter", "pastel-highlighter"],
    ] as const;
    for (const [presetId, ...rest] of specialists) {
      for (const brushId of [presetId, ...rest]) {
        expect(resolveStudioHokusaiLiveAutoRouteDecision(brushId, brushId), brushId)
          .toEqual({
            status: "admitted",
            identity: brushId,
            identityAuthority: "catalog-id",
            presetId,
            materialProfileId: presetId,
            policyVersion: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY.version,
            qualityGate: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE,
          });
      }
    }
    expect(STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY.withheldSpecialistIdentities)
      .toHaveLength(0);

    // Eligibility is not production routing, and this test exists so the two never get conflated.
    // resolveStudioHokusaiProductLiveAdmission additionally requires a promoted-preset entry, and
    // that list is empty while the full-size comparison fails parity/throughput - so the normal
    // shelf starts no WASM stroke for ANY identity. Eligibility only changes what an EXPLICIT
    // experimental opt-in gets: a real engine stroke instead of "identity-not-supported".
    for (const brushId of ["calligraphy", "marker", "pencil", "charcoal", "oil"]) {
      expect(resolveStudioHokusaiProductLiveAdmission({ brushId }), brushId)
        .toMatchObject({
          status: "blocked",
          reason: "fullsize-quality-gate-failed",
        });
      expect(
        resolveStudioHokusaiProductLiveAdmission({
          brushId,
          explicitExperimentalOptIn: true,
        }),
        brushId,
      ).toMatchObject({ status: "admitted", mode: "experimental-explicit-opt-in" });
    }
    expect(resolveStudioHokusaiLiveAutoRouteDecision("dry-media", "pencil"))
      .toEqual({
        status: "rejected",
        reason: "catalog-runtime-identity-mismatch",
      });
  });
});
