import { describe, expect, it, vi } from "vitest";

import { hasContiguousLayerGroups, type LayerGroup } from "../studio-layers";
import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
  STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
  parseStudioSceneLayerLiftRequest,
} from "./studio-layer-lift-contract";
import { prepareStudioLayerLiftMask } from "./studio-layer-lift-mask";
import {
  STUDIO_LAYER_LIFT_OUTPUT_BASIS,
  STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE,
  isStudioLayerLiftSourceCurrent,
  planStudioLayerLift,
} from "./studio-layer-lift-plan";

import type { El } from "../studio-element-model";

const SOURCE_RGBA = Uint8Array.from([
  20, 40, 60, 64,
  80, 100, 120, 128,
  140, 160, 180, 192,
  200, 220, 240, 255,
]);

// Deterministically encoded valid 4×1 RGBA PNG fixtures.
const SOURCE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR42mMQ0bBxCEipaOhZsOXAiTsf/gMANLgImNAdwO0AAAAASUVORK5CYII=";
const BACKGROUND_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAFElEQVR42mNggIKeBVsOnLjz4T8AGVwGNJa9xxsAAAAASUVORK5CYII=";
const FOREGROUND_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAE0lEQVR42mMQ0bBxCEipaGCAAgAbbQJlJs9SqgAAAABJRU5ErkJggg==";

function request() {
  return {
    kind: STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId: "lift-request",
    source: {
      sourceId: "source",
      sourceName: "source.png",
      mimeType: "image/png",
      width: 4,
      height: 1,
      pixelCount: 4,
      pixelFormat: "rgba8-srgb-straight",
      channels: 4,
      byteLength: SOURCE_RGBA.byteLength,
      sha256: `sha256:${sha256HexPortable(SOURCE_RGBA)}`,
      bytes: new Uint8Array(SOURCE_RGBA),
    },
    requestedRoles: ["background", "foreground"],
  };
}

function sourceElement(): Extract<El, { type: "image" }> {
  return {
    id: "source",
    type: "image",
    name: "Source",
    src: SOURCE_PNG,
    x: 12,
    y: 24,
    width: 4,
    height: 1,
    rotation: 0,
    opacity: 0.7,
    brightness: 0.2,
    blendMode: "multiply",
    maskSrc: SOURCE_PNG,
    maskEnabled: true,
  };
}

describe("studio layer-lift foundation integration", () => {
  it("strictly admits RGBA, prepares alpha, and plans one atomic BACK → FRONT group", () => {
    const rawRequest = request();
    const requestBefore = structuredClone(rawRequest);
    const parsed = parseStudioSceneLayerLiftRequest(rawRequest);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.detail);

    const confidence = {
      width: 2,
      height: 1,
      confidence: Float32Array.from([1, 0]),
    };
    const confidenceBefore = new Float32Array(confidence.confidence);
    const sourceAlpha = {
      width: parsed.value.source.width,
      height: parsed.value.source.height,
      alpha: Uint8ClampedArray.from(
        { length: parsed.value.source.pixelCount },
        (_, index) => parsed.value.source.bytes[index * 4 + 3]!,
      ),
    };
    const sourceAlphaBefore = new Uint8ClampedArray(sourceAlpha.alpha);
    const prepared = prepareStudioLayerLiftMask({
      confidence,
      sourceAlpha,
      options: { threshold: 0.5 },
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.value.confidence).toMatchObject({ width: 4, height: 1 });
    expect([...prepared.value.foregroundAlpha.alpha]).toEqual([64, 128, 0, 0]);

    const source = Object.freeze(sourceElement());
    const elements: readonly El[] = Object.freeze([source]);
    const groups: readonly LayerGroup[] = Object.freeze([]);
    const documentBefore = structuredClone({ elements, groups });
    const planned = planStudioLayerLift({
      elements,
      groups,
      sourceId: source.id,
      groupId: "lift-group",
      backgroundId: "lift-background",
      foregroundId: "lift-foreground",
      outputBasis: STUDIO_LAYER_LIFT_OUTPUT_BASIS,
      persistenceScope: STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE,
      backgroundPngDataUrl: BACKGROUND_PNG,
      foregroundPngDataUrl: FOREGROUND_PNG,
    });

    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error(planned.message);
    expect(planned.diagnostics.memberOrder).toEqual([
      "original",
      "background",
      "foreground",
    ]);
    expect(planned.nextElements.map((element) => element.id)).toEqual([
      "source",
      "lift-background",
      "lift-foreground",
    ]);
    expect(planned.nextElements[0]).toMatchObject({
      id: source.id,
      hidden: true,
      locked: true,
      brightness: source.brightness,
      maskSrc: source.maskSrc,
    });
    for (const generated of planned.nextElements.slice(1)) {
      expect(generated).not.toHaveProperty("opacity");
      expect(generated).not.toHaveProperty("brightness");
      expect(generated).not.toHaveProperty("blendMode");
      expect(generated).not.toHaveProperty("maskSrc");
      expect(generated).not.toHaveProperty("maskEnabled");
    }
    expect(planned.selectedId).toBe("lift-foreground");
    expect(planned.nextElements.every(
      (element) => element.groupId === planned.newGroup.id,
    )).toBe(true);
    expect(hasContiguousLayerGroups(planned.nextElements)).toBe(true);

    expect(rawRequest).toEqual(requestBefore);
    expect(confidence.confidence).toEqual(confidenceBefore);
    expect(sourceAlpha.alpha).toEqual(sourceAlphaBefore);
    expect({ elements, groups }).toEqual(documentBefore);
    expect(elements[0]).toBe(source);

    expect(isStudioLayerLiftSourceCurrent(planned.sourceFingerprint, {
      elements,
      groups,
      sourceId: source.id,
    })).toBe(true);
    expect(isStudioLayerLiftSourceCurrent(planned.sourceFingerprint, {
      elements: [{ ...source, src: FOREGROUND_PNG }],
      groups,
      sourceId: source.id,
    })).toBe(false);
  });

  it("fails closed before planning when the strict contract has an unknown field", () => {
    const malformed = request();
    Object.assign(malformed.source, { remoteUrl: "https://example.test/source.png" });
    const parsed = parseStudioSceneLayerLiftRequest(malformed);
    const planner = vi.fn(planStudioLayerLift);
    const source = sourceElement();
    const outcome = parsed.ok
      ? planner({
          elements: [source],
          groups: [],
          sourceId: source.id,
          groupId: "lift-group",
          backgroundId: "lift-background",
          foregroundId: "lift-foreground",
          outputBasis: STUDIO_LAYER_LIFT_OUTPUT_BASIS,
          persistenceScope: STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE,
          backgroundPngDataUrl: BACKGROUND_PNG,
          foregroundPngDataUrl: FOREGROUND_PNG,
        })
      : parsed;

    expect(outcome).toMatchObject({ ok: false, reason: "invalid-shape" });
    expect(planner).not.toHaveBeenCalled();
  });
});
