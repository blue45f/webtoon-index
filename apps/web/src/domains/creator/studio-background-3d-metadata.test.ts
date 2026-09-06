import { describe, expect, it } from "vitest";

import {
  encodeBg3dSceneHash,
  parseBg3dSceneFromDataUrl,
  parseStudio3dTool,
  type BgPrimitive,
} from "./studio-background-3d-metadata";

const PRIMITIVE: BgPrimitive = {
  id: "bg3d-roundtrip",
  kind: "box",
  position: [1, 2, 3],
  rotation: [0.1, 0.2, 0.3],
  scale: [4, 5, 6],
  color: "#abcdef",
};

function dataUrlFor(hash: string): string {
  return `data:image/png;base64,AA==#${hash}`;
}

describe("studio-background-3d-metadata", () => {
  it("round-trips the canonical bg3d fragment without changing primitive metadata", () => {
    const hash = encodeBg3dSceneHash([PRIMITIVE]);

    expect(JSON.parse(decodeURIComponent(hash))).toEqual({
      tool: "bg3d",
      primitives: [PRIMITIVE],
    });
    expect(parseBg3dSceneFromDataUrl(dataUrlFor(hash))).toEqual([PRIMITIVE]);
    expect(parseStudio3dTool(dataUrlFor(hash))).toBe("bg3d");
  });

  it("preserves the legacy hash contract as vrm-poser", () => {
    const legacy = encodeURIComponent(JSON.stringify({ bones: { head: [0, 0, 0] } }));
    const explicitVrm = encodeURIComponent(JSON.stringify({ tool: "vrm-poser", pose: {} }));

    expect(parseStudio3dTool(dataUrlFor(legacy))).toBe("vrm-poser");
    expect(parseStudio3dTool(dataUrlFor(explicitVrm))).toBe("vrm-poser");
    expect(parseBg3dSceneFromDataUrl(dataUrlFor(legacy))).toBeNull();
  });

  it("rejects bg3d-shaped hashes with the wrong tool or primitives shape", () => {
    const wrongTool = encodeURIComponent(JSON.stringify({ tool: "vrm-poser", primitives: [] }));
    const wrongPrimitives = encodeURIComponent(JSON.stringify({ tool: "bg3d", primitives: {} }));

    expect(parseBg3dSceneFromDataUrl(dataUrlFor(wrongTool))).toBeNull();
    expect(parseBg3dSceneFromDataUrl(dataUrlFor(wrongPrimitives))).toBeNull();
    // Tool detection intentionally depends only on the discriminator; scene validation is separate.
    expect(parseStudio3dTool(dataUrlFor(wrongPrimitives))).toBe("bg3d");
  });

  it.each([
    undefined,
    "",
    "data:image/png;base64,AA==",
    "data:image/png;base64,AA==#",
    "data:image/png;base64,AA==#%E0%A4%A",
    "data:image/png;base64,AA==#%7Bnot-json%7D",
    `data:image/png;base64,AA==#${encodeURIComponent("null")}`,
  ])("rejects absent or malformed URI metadata: %s", (src) => {
    expect(parseStudio3dTool(src)).toBeNull();
    expect(parseBg3dSceneFromDataUrl(src)).toBeNull();
  });

  it("keeps accepting opaque primitive records for legacy round-trip compatibility", () => {
    const legacyPrimitive = { id: "legacy", kind: "future-kind", vendorField: { value: 1 } };
    const hash = encodeURIComponent(JSON.stringify({ tool: "bg3d", primitives: [legacyPrimitive] }));

    expect(parseBg3dSceneFromDataUrl(dataUrlFor(hash))).toEqual([legacyPrimitive]);
  });
});
