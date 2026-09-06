import { describe, expect, it } from "vitest";

import {
  applyStudioBg3dMoodRig,
  getStudioBg3dMoodRig,
  resolveStudioBg3dAppliedMoodRig,
  STUDIO_BG3D_MOOD_RIGS,
} from "./studio-bg3d-mood-rigs";
import {
  createDefaultStudioBg3dSceneDocument,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

describe("Studio BG3D mood rigs", () => {
  it("exposes unique, deeply frozen built-ins with canonical unit light directions", () => {
    expect(new Set(STUDIO_BG3D_MOOD_RIGS.map((rig) => rig.id)).size)
      .toBe(STUDIO_BG3D_MOOD_RIGS.length);
    expect(Object.isFrozen(STUDIO_BG3D_MOOD_RIGS)).toBe(true);
    for (const rig of STUDIO_BG3D_MOOD_RIGS) {
      expect(Object.isFrozen(rig)).toBe(true);
      expect(Object.isFrozen(rig.background)).toBe(true);
      expect(Object.isFrozen(rig.lighting.key.direction)).toBe(true);
      expect(Math.hypot(...rig.lighting.key.direction)).toBeCloseTo(1, 12);
      expect(Math.hypot(...rig.lighting.fill.direction)).toBeCloseTo(1, 12);
      expect(getStudioBg3dMoodRig(rig.id)).toBe(rig);
      const applied = applyStudioBg3dMoodRig(createDefaultStudioBg3dSceneDocument(), rig.id);
      expect(applied).not.toBeNull();
      expect(resolveStudioBg3dAppliedMoodRig(applied!)).toBe(rig);
    }
  });

  it("atomically links sky, fog, lighting, exposure, and tone mapping through the canonical boundary", () => {
    const original = createDefaultStudioBg3dSceneDocument();
    const rig = getStudioBg3dMoodRig("golden-hour")!;
    const applied = applyStudioBg3dMoodRig(original, rig.id);

    expect(applied).not.toBeNull();
    expect(applied?.background).toMatchObject({
      ...rig.background,
      mode: "sky-preset",
    });
    expect(applied?.lighting).toEqual(rig.lighting);
    expect(applied?.render).toEqual({
      ...original.render,
      ...rig.render,
    });
    expect(resolveStudioBg3dAppliedMoodRig(applied!)).toBe(rig);

    const serialized = serializeStudioBg3dSceneDocument(applied);
    expect(serialized).not.toBeNull();
    expect(parseStudioBg3dSceneDocument(serialized ?? "")).toEqual(applied);
    expect(Object.isFrozen(applied)).toBe(true);
  });

  it("preserves composition, content, budgets, LT/output settings, and transparent export intent", () => {
    const base = createDefaultStudioBg3dSceneDocument();
    const scene = {
      ...base,
      camera: { ...base.camera, fovDegrees: 72 },
      render: { ...base.render, antialias: false, shadows: false },
      background: { ...base.background, mode: "transparent" as const },
      output: {
        ...base.output,
        transparentBackground: true,
        exportHeight: 2_048,
        line: { ...base.output.line, strength: 0.61 },
      },
    } satisfies StudioBg3dSceneDocument;
    const canonical = parseStudioBg3dSceneDocument(
      serializeStudioBg3dSceneDocument(scene) ?? "",
    )!;
    expect(canonical).not.toBeNull();
    const applied = applyStudioBg3dMoodRig(canonical, "blue-night")!;

    expect(applied.background.mode).toBe("transparent");
    expect(applied.output.transparentBackground).toBe(true);
    expect(applied.camera).toEqual(canonical.camera);
    expect(applied.output).toEqual(canonical.output);
    expect(applied.quality).toEqual(canonical.quality);
    expect(applied.budgets).toEqual(canonical.budgets);
    expect(applied.attachments).toEqual(canonical.attachments);
    expect(applied.nodes).toEqual(canonical.nodes);
    expect(applied.render.antialias).toBe(false);
    expect(applied.render.shadows).toBe(false);
    expect(applied.render.colorSpace).toBe("srgb");
  });

  it("reports custom after a linked field is manually changed and never applies unknown ids", () => {
    const applied = applyStudioBg3dMoodRig(
      createDefaultStudioBg3dSceneDocument(),
      "soft-mist",
    )!;
    expect(resolveStudioBg3dAppliedMoodRig(applied)?.id).toBe("soft-mist");

    const manuallyAdjusted: StudioBg3dSceneDocument = {
      ...applied,
      render: { ...applied.render, exposure: 1.2 },
    };
    expect(resolveStudioBg3dAppliedMoodRig(manuallyAdjusted)).toBeNull();
    expect(getStudioBg3dMoodRig("future-rig")).toBeNull();
    expect(applyStudioBg3dMoodRig(applied, "future-rig")).toBeNull();
  });

  it("fails closed for a non-canonical source scene without normalizing it in place", () => {
    const valid = createDefaultStudioBg3dSceneDocument();
    const hostile = {
      ...valid,
      render: { ...valid.render, exposure: Number.POSITIVE_INFINITY },
    } as StudioBg3dSceneDocument;

    expect(applyStudioBg3dMoodRig(hostile, "clear-day")).toBeNull();
    expect(hostile.render.exposure).toBe(Number.POSITIVE_INFINITY);
  });
});
