import { hokusaiProviderDescriptor } from "@toonspectrum/studio-brush-platform";
import { describe, expect, it } from "vitest";

import { deriveStudioV11BackendDescriptors } from "./studio-engine-provider-bridge";

describe("studio-engine-provider-bridge — fail-closed provider agreement", () => {
  it("derives hokusai-myb-worker without a runtime fallback field", () => {
    const descriptors = deriveStudioV11BackendDescriptors();
    const hokusai = descriptors.find(({ id }) => id === "hokusai-myb-worker");

    expect(hokusai).toBeDefined();
    expect(hokusai).not.toHaveProperty("fallbackProviderId");
  });

  it("agrees with the platform bootstrap descriptor's fail-closed declaration", () => {
    const descriptors = deriveStudioV11BackendDescriptors();
    const bridged = descriptors.find(({ id }) => id === "hokusai-myb-worker");

    expect(hokusaiProviderDescriptor).not.toHaveProperty("fallbackProviderId");
    expect(bridged).not.toHaveProperty("fallbackProviderId");
    // The policy rationale is documented on the platform descriptor: an
    // incapable device hides the brush rather than substituting texture.
    expect(
      hokusaiProviderDescriptor.limitations.some((limitation) =>
        limitation.includes("hide natural-media brushes") &&
        limitation.includes("instead of substituting texture"),
      ),
    ).toBe(true);
  });

  it("keeps every derived backend single-provider and fail-closed", () => {
    const descriptors = deriveStudioV11BackendDescriptors();
    for (const descriptor of descriptors) {
      expect(descriptor).not.toHaveProperty("fallbackProviderId");
      expect(descriptor.limitations).toContain(
        "provider failure is terminal for this binding; no automatic backend substitution",
      );
    }
  });
});
