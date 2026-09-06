import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_ROOM_PRESETS,
  buildStudioBg3dRoomParts,
  getStudioBg3dRoomPreset,
} from "../bg3d/studio-bg3d-room-builder";
import { STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS } from "../bg3d/studio-bg3d-scene-document";
import { hashStudioEditableMesh } from "../studio-editable-half-edge-mesh";

import {
  buildStudioHybridDccRoomAuthority,
  buildStudioHybridDccRoomPresetAuthority,
} from "./studio-hybrid-dcc-room-authority";

describe("Hybrid DCC editable room authority", () => {
  it("keeps every shipped room preset inside the BG3D handoff attachment budget", () => {
    // Classroom alone was ~66 parts when the BG3D attachment cap was 64, which
    // broke the product path "교실 세트 → 3D 배경 편집기" with no extra props.
    for (const preset of STUDIO_BG3D_ROOM_PRESETS) {
      const build = buildStudioHybridDccRoomPresetAuthority(preset.id, preset.id);
      expect(build.assets.length).toBeGreaterThan(0);
      expect(build.assets.length).toBeLessThanOrEqual(
        STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
      );
      // Leave headroom for a few CAD/prop assets created in the same session.
      expect(build.assets.length).toBeLessThanOrEqual(
        STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS - 8,
      );
    }
  });

  it("turns every classroom part into a deterministic editable authority asset", () => {
    const preset = getStudioBg3dRoomPreset("classroom")!;
    const expectedParts = buildStudioBg3dRoomParts(preset.spec);
    const first = buildStudioHybridDccRoomPresetAuthority("classroom", "classroom-1");
    const second = buildStudioHybridDccRoomPresetAuthority("classroom", "classroom-1");

    expect(first.assets).toHaveLength(expectedParts.length);
    expect(new Set(first.assets.map(({ assetId }) => assetId)).size).toBe(first.assets.length);
    expect(first.assets.map(({ assetId }) => assetId)).toEqual(
      second.assets.map(({ assetId }) => assetId),
    );
    expect(first.assets.map(({ mesh }) => hashStudioEditableMesh(mesh))).toEqual(
      second.assets.map(({ mesh }) => hashStudioEditableMesh(mesh)),
    );
    expect(first.assets[0]).toMatchObject({
      assetId: "room-classroom-1-part-001",
      groupId: "room:classroom-1",
      label: "바닥",
      semanticKind: "floor",
      materialId: `room-color:${preset.spec.floorColor}`,
    });
    expect(first.assets.some(({ semanticKind }) => semanticKind === "wall")).toBe(true);
    expect(first.assets.some(({ semanticKind }) => semanticKind === "furniture")).toBe(true);
    expect(first.assets.every(({ mesh }) => mesh.vertices.length > 0 && mesh.faces.length > 0))
      .toBe(true);
  });

  it("preserves exact part placement, color, and commercial provenance", () => {
    const preset = getStudioBg3dRoomPreset("cafe")!;
    const parts = buildStudioBg3dRoomParts(preset.spec);
    const build = buildStudioHybridDccRoomPresetAuthority("cafe", "set-a");
    for (const [index, asset] of build.assets.entries()) {
      const part = parts[index]!;
      expect(asset.transform.position).toEqual(part.position);
      expect(asset.transform.rotationEulerRad).toEqual(part.rotation);
      expect(asset.transform.scale).toEqual(part.scale);
      expect(asset.color).toBe(part.color);
      expect(asset.rights).toMatchObject({
        source: "studio-room-preset:cafe",
        creator: "ToonSpectrum Studio",
        license: "CC0-1.0",
        useScope: "commercial",
      });
    }
  });

  it("supports a custom room recipe and rejects unsafe identity or unknown presets", () => {
    const build = buildStudioHybridDccRoomAuthority({
      width: 4,
      depth: 3,
      wallHeight: 2.4,
      openings: [{
        wall: "south",
        type: "door",
        centerOffset: 0,
        width: 0.9,
        height: 2,
        sillHeight: 0,
      }],
    }, "custom-room");
    expect(build.presetId).toBeNull();
    expect(build.assets.filter(({ semanticKind }) => semanticKind === "wall").length)
      .toBeGreaterThan(4);
    expect(() => buildStudioHybridDccRoomAuthority({}, "한글만"))
      .toThrow("인스턴스 ID");
    expect(() => buildStudioHybridDccRoomPresetAuthority("missing"))
      .toThrow("알 수 없는 방 프리셋");
  });
});
