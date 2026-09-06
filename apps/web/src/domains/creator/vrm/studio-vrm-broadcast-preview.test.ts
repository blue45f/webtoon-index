import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_BROADCAST_BACKGROUNDS,
  STUDIO_VRM_BROADCAST_FRAMEBUFFER_ESTIMATED_BYTES_PER_PIXEL,
  STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_BYTES,
  createStudioVrmBroadcastPreviewPlan,
  planStudioVrmBroadcastFramebuffer,
} from "./studio-vrm-broadcast-preview";

describe("studio VRM broadcast preview planner", () => {
  it("admits only the fixed green, blue, and black backgrounds", () => {
    expect(STUDIO_VRM_BROADCAST_BACKGROUNDS).toEqual([
      { id: "green", label: "크로마 그린", hex: "#00b140" },
      { id: "blue", label: "크로마 블루", hex: "#0047bb" },
      { id: "black", label: "블랙", hex: "#000000" },
    ]);

    const forged = createStudioVrmBroadcastPreviewPlan({
      backgroundId: "magenta" as "green",
    });
    expect(forged).toMatchObject({ ok: false, blocker: "invalid-background" });
  });

  it("returns a deeply frozen runtime-only receipt without project fields", () => {
    const plan = createStudioVrmBroadcastPreviewPlan({ backgroundId: "green" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.receipt).toEqual({
      kind: "toonspectrum.studio-vrm-broadcast-preview",
      version: 1,
      background: { id: "green", label: "크로마 그린", hex: "#00b140" },
      authority: "runtime-only",
    });
    expect(Object.isFrozen(plan.receipt)).toBe(true);
    expect(Object.isFrozen(plan.receipt.background)).toBe(true);
    expect(JSON.stringify(plan.receipt)).not.toMatch(/project|opfs|camera|history/iu);
  });

  it.each([
    ["model-unavailable", "VRM 모델"],
    ["asset-mutation", "업로드·삭제"],
    ["capture", "캡처·공유"],
    ["creative-persistence", "포즈·상태 저장"],
    ["texture-paint", "표면 페인트"],
    ["pose-transaction", "포즈·체형·관절"],
    ["camera-motion", "턴테이블"],
    ["tracking-transition", "추적 준비·보정"],
  ] as const)("fails closed on %s", (blocker, expected) => {
    const plan = createStudioVrmBroadcastPreviewPlan({
      backgroundId: "blue",
      blockers: [blocker],
    });

    expect(plan).toMatchObject({ ok: false, blocker });
    if (plan.ok) return;
    expect(plan.reason).toContain(expected);
  });

  it("uses the caller's deterministic blocker priority", () => {
    const plan = createStudioVrmBroadcastPreviewPlan({
      backgroundId: "black",
      blockers: ["capture", "texture-paint"],
    });

    expect(plan).toMatchObject({ ok: false, blocker: "capture" });
  });
});

describe("studio VRM broadcast framebuffer admission", () => {
  it("admits sub-1 DPR and keeps the requested value when it already fits", () => {
    const plan = planStudioVrmBroadcastFramebuffer({
      cssWidth: 640,
      cssHeight: 360,
      requestedDpr: 0.75,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.receipt).toMatchObject({
      dpr: 0.75,
      pixelWidth: 480,
      pixelHeight: 270,
      maxBytes: 64 * 1024 * 1024,
      estimatedBytesPerPixel: 48,
      authority: "runtime-only",
    });
    expect(plan.receipt.estimatedBytes).toBe(480 * 270 * 48);
    expect(Object.isFrozen(plan.receipt)).toBe(true);
    expect(Object.isFrozen(plan.receipt.antialiasEstimate)).toBe(true);
  });

  it("derives a non-fixed DPR from the actual CSS extent under the 64 MiB budget", () => {
    const hd = planStudioVrmBroadcastFramebuffer({
      cssWidth: 1_920,
      cssHeight: 1_080,
      requestedDpr: 2,
    });
    const compact = planStudioVrmBroadcastFramebuffer({
      cssWidth: 1_280,
      cssHeight: 720,
      requestedDpr: 2,
    });

    expect(hd.ok).toBe(true);
    expect(compact.ok).toBe(true);
    if (!hd.ok || !compact.ok) return;
    expect(hd.receipt.dpr).toBeLessThan(1);
    expect(compact.receipt.dpr).toBeGreaterThan(hd.receipt.dpr);
    for (const receipt of [hd.receipt, compact.receipt]) {
      expect(receipt.estimatedBytes).toBeLessThanOrEqual(
        STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_BYTES,
      );
      expect(receipt.estimatedBytes).toBe(
        receipt.pixelWidth
          * receipt.pixelHeight
          * STUDIO_VRM_BROADCAST_FRAMEBUFFER_ESTIMATED_BYTES_PER_PIXEL,
      );
      expect(Number.isSafeInteger(receipt.estimatedBytes)).toBe(true);
      expect(receipt.antialiasEstimate).toEqual({
        msaaSamples: 4,
        includesColorDepthResolveAndHeadroom: true,
      });
    }
  });

  it("admits an 8K fullscreen host below quarter DPR without crossing the byte ceiling", () => {
    const plan = planStudioVrmBroadcastFramebuffer({
      cssWidth: 7_680,
      cssHeight: 4_320,
      requestedDpr: 2,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.receipt.dpr).toBeGreaterThanOrEqual(0.125);
    expect(plan.receipt.dpr).toBeLessThan(0.25);
    expect(plan.receipt.estimatedBytes).toBeLessThanOrEqual(
      STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_BYTES,
    );
  });

  it.each([
    [{ cssWidth: 0, cssHeight: 720, requestedDpr: 1 }, "invalid-css-edge"],
    [{ cssWidth: 1_280, cssHeight: Number.POSITIVE_INFINITY, requestedDpr: 1 }, "invalid-css-edge"],
    [{ cssWidth: 16_385, cssHeight: 720, requestedDpr: 1 }, "invalid-css-edge"],
    [{ cssWidth: 1_280, cssHeight: 720, requestedDpr: Number.NaN }, "invalid-dpr"],
    [{ cssWidth: 1_280, cssHeight: 720, requestedDpr: 0.1 }, "invalid-dpr"],
    [{ cssWidth: 1_280, cssHeight: 720, requestedDpr: 9 }, "invalid-dpr"],
  ] as const)("fails closed for invalid extent or DPR %#", (input, blocker) => {
    expect(planStudioVrmBroadcastFramebuffer(input)).toMatchObject({
      ok: false,
      blocker,
    });
  });

  it("fails closed when even minimum DPR would exceed the byte budget", () => {
    const plan = planStudioVrmBroadcastFramebuffer({
      cssWidth: 16_384,
      cssHeight: 16_384,
      requestedDpr: 2,
    });

    expect(plan).toMatchObject({ ok: false, blocker: "framebuffer-byte-budget" });
  });
});
