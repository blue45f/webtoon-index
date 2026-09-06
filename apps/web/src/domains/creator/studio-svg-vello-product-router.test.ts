import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_SVG_PRODUCT_SELECTED_PROVIDER_ID,
  StudioSvgProductTournament,
  type StudioSvgProductEngines,
} from "./studio-svg-vello-product-router";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#f00"/></svg>';

function engines(overrides: Partial<StudioSvgProductEngines> = {}): StudioSvgProductEngines {
  return {
    auditVello: vi.fn(async () => ({ elementCount: 2, maxDepth: 2, localReferenceCount: 0 })),
    renderVelloCpu: vi.fn(async () => new Uint8Array(2 * 2 * 4).fill(17)),
    ...overrides,
  };
}

function input(svg = SVG) {
  return {
    assetId: "shape-red",
    svg,
    width: 2,
    height: 2,
    trust: "bundled-catalog" as const,
    selectedProviderId: STUDIO_SVG_PRODUCT_SELECTED_PROVIDER_ID,
  };
}

describe("Studio SVG single-provider product resolver", () => {
  it("executes only the provider selected before the request", async () => {
    const ports = engines();
    const result = await new StudioSvgProductTournament(ports).resolve(input());

    expect(ports.auditVello).toHaveBeenCalledOnce();
    expect(ports.renderVelloCpu).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      selectedProviderId: "vello-svg-native",
      providerId: "vello-svg-native",
      route: "selected-vello-native",
      sourcePreserved: true,
      interactiveGpuReadbackBytes: 0,
    });
  });

  it("fails closed after a selected-provider audit failure without invoking legacy alternates", async () => {
    const renderVelloCpu = vi.fn(async () => new Uint8Array(16));
    const legacyAlternates = {
      importScene: vi.fn(),
      renderScene: vi.fn(),
      renderResvg: vi.fn(),
      renderBrowserNative: vi.fn(),
    };
    const ports = {
      auditVello: vi.fn(async () => { throw new Error("strict subset rejected polygon"); }),
      renderVelloCpu,
      ...legacyAlternates,
    };

    const result = await new StudioSvgProductTournament(ports).resolve(input());

    expect(result).toMatchObject({
      selectedProviderId: "vello-svg-native",
      providerId: "rejected",
      route: "fail-closed",
      pixels: null,
    });
    expect(result.reasons.join(" ")).toContain("strict subset rejected polygon");
    expect(renderVelloCpu).not.toHaveBeenCalled();
    expect(legacyAlternates.importScene).not.toHaveBeenCalled();
    expect(legacyAlternates.renderScene).not.toHaveBeenCalled();
    expect(legacyAlternates.renderResvg).not.toHaveBeenCalled();
    expect(legacyAlternates.renderBrowserNative).not.toHaveBeenCalled();
  });

  it("fails closed after a selected-provider render failure", async () => {
    const ports = engines({
      renderVelloCpu: vi.fn(async () => { throw new Error("Vello unavailable"); }),
    });
    const result = await new StudioSvgProductTournament(ports).resolve(input());

    expect(result).toMatchObject({
      selectedProviderId: "vello-svg-native",
      providerId: "rejected",
      route: "fail-closed",
      audit: { elementCount: 2 },
    });
    expect(result.reasons.join(" ")).toContain("Vello unavailable");
  });

  it("rejects a malformed selected-provider surface instead of replaying another renderer", async () => {
    const result = await new StudioSvgProductTournament(engines({
      renderVelloCpu: vi.fn(async () => new Uint8Array(4)),
    })).resolve(input());

    expect(result.providerId).toBe("rejected");
    expect(result.reasons.join(" ")).toContain("renderer returned 4 bytes");
  });

  it("fails closed for active or externally resolved SVG before loading the provider", async () => {
    const ports = engines();
    const result = await new StudioSvgProductTournament(ports).resolve(
      input('<svg width="2" height="2"><script>alert(1)</script></svg>'),
    );

    expect(result.providerId).toBe("rejected");
    expect(result.unsupported).toContain("security:active-or-external-content");
    expect(ports.auditVello).not.toHaveBeenCalled();
    expect(ports.renderVelloCpu).not.toHaveBeenCalled();
  });

  it("rejects invalid requests before loading the selected provider", async () => {
    const ports = engines();
    const result = await new StudioSvgProductTournament(ports).resolve({
      ...input(),
      width: 0,
    });

    expect(result.providerId).toBe("rejected");
    expect(ports.auditVello).not.toHaveBeenCalled();
    expect(ports.renderVelloCpu).not.toHaveBeenCalled();
  });

  it("deduplicates in-flight work and returns the cached immutable decision", async () => {
    const ports = engines();
    const tournament = new StudioSvgProductTournament(ports);
    const first = tournament.resolve(input());
    const second = tournament.resolve(input());
    const [a, b] = await Promise.all([first, second]);
    const cached = await tournament.resolve(input());

    expect(a).toBe(b);
    expect(cached).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(ports.auditVello).toHaveBeenCalledOnce();
    expect(ports.renderVelloCpu).toHaveBeenCalledOnce();
    expect(tournament.metrics()).toMatchObject({ cachedEntries: 1, inFlight: 0, active: 0 });
  });

  it("does not reuse an asset-specific decision across equal SVG sources", async () => {
    const ports = engines();
    const tournament = new StudioSvgProductTournament(ports);
    const first = await tournament.resolve(input());
    const second = await tournament.resolve({ ...input(), assetId: "shape-red-copy" });

    expect(first.assetId).toBe("shape-red");
    expect(second.assetId).toBe("shape-red-copy");
    expect(first.sourceDigest).toBe(second.sourceDigest);
    expect(ports.auditVello).toHaveBeenCalledTimes(2);
  });
});
