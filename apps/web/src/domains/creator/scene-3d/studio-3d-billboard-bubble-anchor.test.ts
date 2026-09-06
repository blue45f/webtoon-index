import { describe, expect, it } from "vitest";

import {
  Studio3DBillboardBubbleEngine,
  SOCKET_LOCAL_OFFSETS,
} from "./studio-3d-billboard-bubble-anchor";

describe("Studio3DBillboardBubbleEngine", () => {
  const engine = new Studio3DBillboardBubbleEngine();

  it("initializes with default sample speech bubble and emote", () => {
    expect(engine.getBubbles().length).toBe(1);
    expect(engine.getEmotes().length).toBe(1);
    expect(engine.getBubbles()[0].kind).toBe("speech");
    expect(engine.getEmotes()[0].kind).toBe("sweat");
  });

  it("adds and removes custom speech bubbles and emotes", () => {
    const newBubble = engine.addBubble({
      text: "어?! 저 녀석은…!",
      kind: "shout",
      socket: "head-top",
      offset: { x: 0, y: 0.4, z: 0 },
      scale: 1.2,
      billboardFacing: true,
      tailTargetOffset: { x: 0, y: -0.4, z: 0 },
      bubbleBgColor: "#ffffff",
      textColor: "#e11d48",
    });

    expect(newBubble.id).toBeDefined();
    expect(engine.getBubbles().length).toBe(2);

    engine.removeBubble(newBubble.id);
    expect(engine.getBubbles().length).toBe(1);
  });

  it("computes anchor world position from character head socket", () => {
    const headPos = { x: 1.0, y: 1.7, z: 0.5 };
    const socket = "head-top";
    const offset = { x: 0.1, y: 0.1, z: 0.0 };

    const worldPos = engine.computeAnchorWorldPosition(headPos, socket, offset);
    const expectedY = headPos.y + SOCKET_LOCAL_OFFSETS["head-top"].y + offset.y;

    expect(worldPos.x).toBeCloseTo(1.1, 2);
    expect(worldPos.y).toBeCloseTo(expectedY, 2);
    expect(worldPos.z).toBeCloseTo(0.5, 2);
  });

  it("computes billboard Euler angles facing the camera", () => {
    const itemPos = { x: 0, y: 1.5, z: 0 };
    const cameraPos = { x: 0, y: 1.5, z: 5 }; // Camera directly in front (+Z)

    const rot = engine.computeBillboardRotation(itemPos, cameraPos);
    expect(rot.rotationEulerYDeg).toBeCloseTo(0, 1);
    expect(rot.rotationEulerXDeg).toBeCloseTo(0, 1);
  });

  it("generates valid SVG paths for speech, shout, thought, and whisper balloons", () => {
    const speechPath = engine.generateBubbleSvgPath("speech", 120, 60, 30, 80);
    expect(speechPath).toContain("M ");
    expect(speechPath).toContain("Z");

    const shoutPath = engine.generateBubbleSvgPath("shout", 140, 70, 50, 95);
    expect(shoutPath).toContain("M 0");
    expect(shoutPath).toContain("Z");

    const thoughtPath = engine.generateBubbleSvgPath("thought", 100, 50, 20, 65);
    expect(thoughtPath).toContain("Q ");
    expect(thoughtPath).toContain("Z");

    const whisperPath = engine.generateBubbleSvgPath("whisper", 120, 60, 0, 0);
    expect(whisperPath).toContain("M ");
  });
});
