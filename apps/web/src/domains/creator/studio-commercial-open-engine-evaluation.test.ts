import { describe, expect, it } from "vitest";

import {
  listBlockedCommercialOpenEngines,
  listShippableCommercialOpenEngines,
  resolveCommercialOpenEnginesForTextureKind,
  resolveStudioCommercialOpenEngineAdoptionSummary,
  STUDIO_COMMERCIAL_OPEN_ENGINE_CATALOG,
} from "./studio-commercial-open-engine-evaluation";
import {
  mixStudioSpectralPigmentApprox,
  studioSpectralMixBeatsRgbLerpOnBlueYellow,
} from "./studio-spectral-pigment-mix-approx";

describe("commercial / open engine evaluation", () => {
  it("never marks Mixbox or Inkwash as shippable without license", () => {
    const mixbox = STUDIO_COMMERCIAL_OPEN_ENGINE_CATALOG.find(
      (e) => e.id === "mixbox",
    );
    const inkwash = STUDIO_COMMERCIAL_OPEN_ENGINE_CATALOG.find(
      (e) => e.id === "inkwash",
    );
    expect(mixbox?.mayShipInProduct).toBe(false);
    expect(mixbox?.licenseClass).toBe("non-commercial-block");
    expect(inkwash?.mayShipInProduct).toBe(false);
    expect(inkwash?.licenseClass).toBe("no-license-block");
  });

  it("allows MIT/ISC/Apache engines as shippable supporting or pin candidates", () => {
    const ids = new Set(listShippableCommercialOpenEngines().map((e) => e.id));
    expect(ids.has("libmypaint")).toBe(true);
    expect(ids.has("pavel-webgl-fluid")).toBe(true);
    expect(ids.has("klecks-kleki")).toBe(true);
    expect(ids.has("hokusai-wasm")).toBe(true);
    expect(ids.has("google-liquidfun-paint")).toBe(true);
    expect(ids.has("mixbox")).toBe(false);
    expect(ids.has("clip-studio-paint")).toBe(false);
  });

  it("maps wet and oil texture kinds to evaluated engines", () => {
    const wet = resolveCommercialOpenEnginesForTextureKind("wet-watercolor");
    expect(wet.some((e) => e.id === "pavel-webgl-fluid")).toBe(true);
    expect(wet.some((e) => e.id === "inkwash")).toBe(true);

    const oil = resolveCommercialOpenEnginesForTextureKind("paint-oil");
    expect(oil.some((e) => e.id === "libmypaint")).toBe(true);
    expect(oil.some((e) => e.id === "mixbox" && !e.mayShipInProduct)).toBe(
      true,
    );
  });

  it("summarizes texture-first adoption without cross-engine fallback wording", () => {
    const summary = resolveStudioCommercialOpenEngineAdoptionSummary();
    expect(summary.shippableCount).toBeGreaterThan(5);
    expect(summary.blockedCount).toBeGreaterThan(2);
    expect(summary.textureFirstOrder[0]).toBe(
      "pin-best-open-texture-engine-per-kind",
    );
    expect(summary.coreAdditions.some((s) => s.includes("stable-fluid"))).toBe(
      true,
    );
    expect(listBlockedCommercialOpenEngines().length).toBe(
      summary.blockedCount,
    );
  });
});

describe("spectral pigment mix approx (not Mixbox)", () => {
  it("produces a greener blue+yellow mix than RGB lerp", () => {
    expect(studioSpectralMixBeatsRgbLerpOnBlueYellow()).toBe(true);
    const mixed = mixStudioSpectralPigmentApprox(
      { r: 0, g: 33, b: 133 },
      { r: 252, g: 211, b: 0 },
      0.5,
    );
    expect(mixed.g).toBeGreaterThan(40);
  });
});
