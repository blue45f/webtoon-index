import { describe, it, expect } from "vitest";

import { Studio3DTooningEmotionFxEngine } from "./studio-3d-tooning-emotion-fx";

describe("Studio3DTooningEmotionFxEngine", () => {
  it("initializes with neutral emotion and empty bubble/emote collections", () => {
    const engine = new Studio3DTooningEmotionFxEngine();
    expect(engine.getActiveEmotion()).toBe("neutral-calm");
    expect(engine.getBubbles().length).toBe(0);
    expect(engine.getEmotes().length).toBe(0);
  });

  it("evaluates blendshape weights for joyful and rage presets", () => {
    const engine = new Studio3DTooningEmotionFxEngine();

    const joy = engine.evaluateBlendshapeWeights("joy-radiant");
    expect(joy.mouthSmile).toBeGreaterThan(0.9);
    expect(joy.eyeSquint).toBeGreaterThan(0.5);

    const rage = engine.evaluateBlendshapeWeights("rage-furious");
    expect(rage.browDown).toBe(1.0);
    expect(rage.mouthFrown).toBeGreaterThan(0.8);
  });

  it("evaluates 3D world-space speech bubble tail vector pointing toward character mouth", () => {
    const engine = new Studio3DTooningEmotionFxEngine();
    const bubble = {
      id: "bubble-1",
      targetCharacterId: "char-1",
      text: "도대체 무슨 소리를 하는 거야?!",
      style: "shout-spiky" as const,
      positionOffset: [0.5, 0.4, 0] as const, // Above and to the right of head
      width: 250,
      height: 100,
      fontSize: 16,
    };

    const evaluated = engine.evaluateBubbleTail(bubble, [0, 1.6, 0]);
    // Tail should point down and left towards mouth
    expect(evaluated.tailDirectionVector[0]).toBeLessThan(0); // towards left (-X)
    expect(evaluated.tailDirectionVector[1]).toBeLessThan(0); // downwards (-Y)
  });

  it("manages 3D emote SFX stickers (sweat drop, anger cross)", () => {
    const engine = new Studio3DTooningEmotionFxEngine();
    engine.addEmote({
      id: "emote-1",
      targetCharacterId: "char-1",
      kind: "anger-cross",
      positionOffset: [0.2, 0.3, 0],
      scale: 1.0,
    });

    expect(engine.getEmotes().length).toBe(1);
    expect(engine.getEmotes()[0].kind).toBe("anger-cross");
  });
});
