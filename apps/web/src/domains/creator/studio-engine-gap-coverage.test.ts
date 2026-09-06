/**
 * ADR 0017 governance: every V13 feature the Vello lanes cannot own must keep a NAMED completion
 * engine in the shipped universe. The next-gen challenger (Skia Graphite) and the CPU reference
 * stay independently selectable, but none of these descriptors encodes an automatic demotion
 * chain. Losing a named lane or reintroducing a fallback link fails the build here, loudly.
 *
 * WHAT THIS GATE DOES NOT PROVE, stated plainly so a green run is never read as more than it is:
 * it checks DECLARATION, not activation. `STUDIO_KNOWN_ENGINE_DESCRIPTORS` is the known capability
 * universe — its own docstring says so ("known universe 등재는 활성화가 아니다") — and a descriptor
 * being present with the right tokens says the lane is nameable and selectable, not that it can
 * render on the device in front of you. Today it demonstrably cannot: `createSkiaGpuIslandBackend`
 * is documented as "probe-only backend used until CanvasKit MakeWebGLCanvasSurface is adopted on a
 * worker" and returns `unavailable` on every uncached request, so the completion lane this file
 * names for mask, image filter, backdrop blend and path effect has no working renderer behind it
 * yet. That is a real gap, and it is a RENDERER gap: the honest response is to report that the
 * selected lane is unavailable rather than substituting another provider. What this gate buys in
 * the meantime is that the explicit provider universe cannot be quietly under-declared.
 */
import {
  planVelloCapabilityGaps,
  validateVelloCapabilityGapCoverage,
} from "@toonspectrum/studio-engine-registry";
import { describe, expect, it } from "vitest";

import { STUDIO_KNOWN_ENGINE_DESCRIPTORS } from "./studio-asset-metadata-registry";

const byId = new Map(
  STUDIO_KNOWN_ENGINE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor])
);

describe("Vello capability-gap alternative-engine coverage", () => {
  it("every Vello gap feature has its named alternative engines in the shipped universe", () => {
    // Validated against the SHIPPED descriptors' own declared capabilities, not against a
    // constant in the registry package: registry queries and activation evidence read
    // descriptor.capabilities, so that is where the completion claim has to hold.
    expect(
      validateVelloCapabilityGapCoverage(STUDIO_KNOWN_ENGINE_DESCRIPTORS)
    ).toEqual([]);
  });

  it("the completion lane declares every gap by the exact token the registry queries", () => {
    // EngineCapabilityRegistry.query matches capabilities.includes(capability) with no wildcard,
    // so an island-completion claim alone would leave this lane unselectable for the gaps it is
    // named to complete.
    const completion = byId.get("skia-canvaskit-gpu");
    const challenger = byId.get("skia-graphite-webgpu");
    for (const feature of [
      "render.text.paragraph",
      "render.mask",
      "render.filter.image",
      "render.blend.backdrop",
      "render.path-effect",
    ]) {
      expect(completion?.capabilities, feature).toContain(feature);
      // The challenger is held to the same standard: a lane that cannot be selected for a gap
      // cannot challenge on it, however it is ranked.
      expect(challenger?.capabilities, feature).toContain(feature);
    }
  });

  it("keeps challenger, completion, and reference roles explicit and chain-free", () => {
    const plan = planVelloCapabilityGaps();
    const challenger = byId.get("skia-graphite-webgpu");
    const completion = byId.get("skia-canvaskit-gpu");
    const reference = byId.get("skia-canvaskit");

    // 모험은 챌린저 신분으로만: 토너먼트 게이트를 통과하기 전까지 experimental이다.
    expect(challenger?.maturity).toBe("experimental");
    expect(plan.challengerProviderId).toBe(challenger?.id);
    expect(plan.completionProviderId).toBe(completion?.id);
    expect(plan.referenceProviderId).toBe(reference?.id);
    expect(challenger).not.toHaveProperty("fallbackProviderId");
    expect(completion).not.toHaveProperty("fallbackProviderId");
    expect(reference).not.toHaveProperty("fallbackProviderId");
    expect(reference?.maturity).toBe("production-baseline");
  });
});
