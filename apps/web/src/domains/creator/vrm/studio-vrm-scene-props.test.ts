import { describe, expect, it } from "vitest";

import {
  parseSceneProps,
  SCENE_PROPS_VERSION,
  serializeSceneProps,
  type ScenePropAttachmentConfig,
} from "./studio-vrm-scene-props";

describe("studio-vrm-scene-props", () => {
  const config: ScenePropAttachmentConfig = {
    bone: "rightHand",
    offsetX: 0.1,
    offsetY: -0.2,
    offsetZ: 0.3,
    rotX: 15,
    rotY: -30,
    rotZ: 45,
    scale: 1.2,
  };

  it("round-trips active world objects and their transforms", () => {
    const serialized = serializeSceneProps(["cat", "sparkle"], { cat: config });
    expect(serialized?.version).toBe(SCENE_PROPS_VERSION);
    expect(parseSceneProps(serialized, ["cat", "sparkle"])).toEqual(serialized);
  });

  it("supports the pre-versioned activeProps/propAttachments shape", () => {
    const parsed = parseSceneProps({ activeProps: ["cat"], propAttachments: { cat: config } }, ["cat"]);
    expect(parsed.active).toEqual(["cat"]);
    expect(parsed.attachments.cat).toEqual(config);
  });

  it("deduplicates ids, drops unknown entries and clamps corrupted transforms", () => {
    const parsed = parseSceneProps({
      active: ["cat", "cat", "unknown", "../bad"],
      attachments: { cat: { bone: "tail", offsetX: 99, rotY: -999, scale: 0 } },
    }, ["cat"]);
    expect(parsed.active).toEqual(["cat"]);
    expect(parsed.attachments.cat).toEqual(expect.objectContaining({ bone: "none", offsetX: 3, rotY: -180, scale: 0.2 }));
  });

  it("omits an empty collection", () => {
    expect(serializeSceneProps([], {})).toBeUndefined();
    expect(parseSceneProps(null)).toEqual({ version: SCENE_PROPS_VERSION, active: [], attachments: {} });
  });
});
