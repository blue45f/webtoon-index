import { describe, expect, it } from "vitest";

import {
  STUDIO_AI_IMAGE_REFERENCE_LIMITS,
  hydrateStudioAiImageReferenceDocument,
} from "../ai/studio-ai-image-reference-roles";

import {
  STUDIO_BG3D_AI_METHOD_REFERENCE_ID,
  applyStudioBg3dAiMethodReference,
} from "./studio-3d-ai-reference-application";

import type { StudioBg3dAiMethodReferenceCapture } from "./studio-3d-ai-reference-handoff";
import type { StudioAssetWithContentHash } from "../studio-asset-library";

const capture = {
  version: 1,
  sourceKind: "bg3d",
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  width: 1,
  height: 1,
  suggestedRole: "method",
  captureIdentity: {
    backend: "three-webgl",
    engineId: "three",
    engineVersion: "184",
    implementationRevision: "studio-three-webgl-capture-adapter-v1",
    graphicsApi: "webgl2",
    profileId: "studio-rgba8-straight-srgb-topdown-depth-f32-v1",
  },
} as StudioBg3dAiMethodReferenceCapture;

function asset(id: string, marker: string): StudioAssetWithContentHash {
  return {
    id,
    name: "3D shot",
    dataUrl: capture.dataUrl,
    contentHash: `sha256:${marker.repeat(64)}`,
    width: 1,
    height: 1,
    createdAt: 1,
    kind: "bg3d-ai-method",
  };
}

describe("applyStudioBg3dAiMethodReference", () => {
  it("adds a role-isolated current-shot Method reference and preserves manual references", () => {
    const before = hydrateStudioAiImageReferenceDocument({
      references: [
        {
          id: "character-a",
          role: "character",
          assetId: "character-asset",
        },
        {
          id: "method-manual",
          role: "method",
          assetId: "manual-method",
        },
      ],
    });

    const result = applyStudioBg3dAiMethodReference(before, asset("shot-a", "a"), capture);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe("added");
    expect(result.document.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "character-a", role: "character" }),
        expect.objectContaining({ id: "method-manual", role: "method" }),
        expect.objectContaining({
          id: STUDIO_BG3D_AI_METHOD_REFERENCE_ID,
          role: "method",
          asset: {
            assetId: "shot-a",
            sha256: `sha256:${"a".repeat(64)}`,
          },
        }),
      ]),
    );
  });

  it("replaces only the previous current-shot reference", () => {
    const first = applyStudioBg3dAiMethodReference(
      hydrateStudioAiImageReferenceDocument({
        references: [{ id: "style-a", role: "style", assetId: "style-asset" }],
      }),
      asset("shot-a", "a"),
      capture,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = applyStudioBg3dAiMethodReference(
      first.document,
      asset("shot-b", "b"),
      capture,
    );

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.action).toBe("replaced");
    expect(
      second.document.references.filter(
        ({ id }) => id === STUDIO_BG3D_AI_METHOD_REFERENCE_ID,
      ),
    ).toHaveLength(1);
    expect(
      second.document.references.find(
        ({ id }) => id === STUDIO_BG3D_AI_METHOD_REFERENCE_ID,
      )?.asset,
    ).toEqual({
      assetId: "shot-b",
      sha256: `sha256:${"b".repeat(64)}`,
    });
    expect(second.document.references.some(({ id }) => id === "style-a")).toBe(true);
  });

  it("fails visibly when the Method role is full and no replaceable 3D shot exists", () => {
    const full = hydrateStudioAiImageReferenceDocument({
      references: Array.from(
        { length: STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxReferencesPerRole },
        (_, index) => ({
          id: `manual-${index}`,
          role: "method",
          assetId: `manual-asset-${index}`,
        }),
      ),
    });

    expect(
      applyStudioBg3dAiMethodReference(full, asset("shot-a", "a"), capture),
    ).toEqual({
      ok: false,
      reason: "method-reference-limit",
    });
  });
});
