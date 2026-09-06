import { describe, expect, it } from "vitest";

import {
  studioLivingInkCanReuseAcceptedAuthority,
  studioLivingInkEffectiveScope,
  studioLivingInkFailureDisposition,
  studioLivingInkProductAdmissionBlocked,
} from "./studio-living-ink-product-admission";

describe("Living Ink product admission", () => {
  it("rejects a pointer-down while a Clear PNG is decoding and reopens only after handoff", () => {
    expect(studioLivingInkProductAdmissionBlocked({
      busy: true,
      finalizing: false,
      hasActiveStroke: false,
      hasCanonicalHandoff: true,
    })).toBe(true);

    expect(studioLivingInkProductAdmissionBlocked({
      busy: false,
      finalizing: false,
      hasActiveStroke: false,
      hasCanonicalHandoff: false,
    })).toBe(false);
  });

  it.each([
    ["busy", { busy: true }],
    ["finalizing", { finalizing: true }],
    ["active stroke", { hasActiveStroke: true }],
    ["canonical handoff", { hasCanonicalHandoff: true }],
  ] as const)("keeps %s independently fail-closed", (_label, patch) => {
    expect(studioLivingInkProductAdmissionBlocked({
      busy: false,
      finalizing: false,
      hasActiveStroke: false,
      hasCanonicalHandoff: false,
      ...patch,
    })).toBe(true);
  });

  it("reuses every locally accepted authority without replay, while reload/external state replays once", () => {
    let replayCount = 0;
    for (let index = 0; index < 20; index += 1) {
      const replayToken = `local-${index}`;
      const canonicalSrc = `data:image/png;base64,local-${index}`;
      // acceptFinishedStroke/acceptAction installs this before React publishes the receipt effect.
      const accepted = { pageId: "page-1", replayToken, canonicalSrc };
      if (!studioLivingInkCanReuseAcceptedAuthority({
        accepted,
        pageId: "page-1",
        replayToken,
        canonicalSrc,
        coordinatorPageId: "page-1",
        coordinatorState: "ready",
      })) replayCount += 1;
    }
    expect(replayCount).toBe(0);

    // A fresh mount/import has no in-memory authority even when its receipt token is valid.
    if (!studioLivingInkCanReuseAcceptedAuthority({
      accepted: null,
      pageId: "page-1",
      replayToken: "external",
      canonicalSrc: "data:image/png;base64,external",
      coordinatorPageId: null,
      coordinatorState: "unavailable",
    })) replayCount += 1;
    expect(replayCount).toBe(1);
  });

  it("preserves the document for failed water and ink without provider substitution", () => {
    expect(studioLivingInkFailureDisposition("water")).toBe("preserve-document-noop");
    expect(studioLivingInkFailureDisposition("ink")).toBe("preserve-document-noop");
  });

  it("uses one effective scope after the canonical image selection is released", () => {
    expect(studioLivingInkEffectiveScope("selection", true)).toBe("selection");
    expect(studioLivingInkEffectiveScope("selection", false)).toBe("all");
    expect(studioLivingInkEffectiveScope("all", true)).toBe("all");
    expect(studioLivingInkEffectiveScope("all", false)).toBe("all");
  });
});
