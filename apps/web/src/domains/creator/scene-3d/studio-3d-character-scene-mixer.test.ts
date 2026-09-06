import { describe, it, expect } from "vitest";

import { Studio3DCharacterSceneMixer } from "./studio-3d-character-scene-mixer";

describe("Studio3DCharacterSceneMixer", () => {
  it("adds character to 3D scene with ground contact alignment", () => {
    const mixer = new Studio3DCharacterSceneMixer("scene-1", "교실 세트장");
    const char = mixer.addCharacter("harin-vrm", "하린", [0, -1, 0]);

    // Position Y should be clamped to groundY (0)
    expect(char.position[1]).toBe(0);
    expect(mixer.getConfig().characters.length).toBe(1);
  });

  it("attaches 3D props to character bone with dual-grip support", () => {
    const mixer = new Studio3DCharacterSceneMixer("scene-1");
    mixer.addCharacter("harin-vrm", "하린");

    const ok = mixer.attachPropToCharacter(
      "harin-vrm",
      "sword-3d",
      "마법 검",
      "rightHand",
      [0, 0.1, 0],
      true,
      "leftHand",
    );

    expect(ok).toBe(true);
    const char = mixer.getCharacter("harin-vrm");
    expect(char?.attachedProps[0].isDualGrip).toBe(true);
    expect(char?.attachedProps[0].secondaryBone).toBe("leftHand");

    const summary = mixer.generateMixSummary();
    expect(summary.totalAttachedProps).toBe(1);
  });

  it("applies seating interaction and elevation", () => {
    const mixer = new Studio3DCharacterSceneMixer("scene-1");
    mixer.addCharacter("harin-vrm", "하린");
    mixer.applySeatingInteraction("harin-vrm", 0.45, [1, 2]);

    const char = mixer.getCharacter("harin-vrm");
    expect(char?.stance).toBe("seated-chair");
    expect(char?.position[1]).toBe(0.45);
    expect(char?.position[0]).toBe(1);
    expect(char?.position[2]).toBe(2);
  });

  it("sets up mutual conversation staging and eye contact between avatars", () => {
    const mixer = new Studio3DCharacterSceneMixer("scene-1");
    mixer.addCharacter("char-a", "주인공 A", [0, 0, 0]);
    mixer.addCharacter("char-b", "히로인 B", [0, 0, 2]);

    const ok = mixer.setupConversationStaging("char-a", "char-b");
    expect(ok).toBe(true);

    const a = mixer.getCharacter("char-a");
    const b = mixer.getCharacter("char-b");

    expect(a?.lookAt.mode).toBe("character");
    expect(a?.lookAt.targetCharacterId).toBe("char-b");
    expect(b?.lookAt.targetCharacterId).toBe("char-a");
  });

  it("harmonizes toon shadow bands across background and character", () => {
    const mixer = new Studio3DCharacterSceneMixer("scene-1");
    mixer.setToonShadowBands(3);

    expect(mixer.getConfig().toonShadowBands).toBe(3);
    const summary = mixer.generateMixSummary();
    expect(summary.toonShadowBands).toBe(3);
  });

  it("toggles camera wall cutaway for indoor 3D scenes", () => {
    const mixer = new Studio3DCharacterSceneMixer("scene-1");
    expect(mixer.getConfig().wallCutawayEnabled).toBe(true);

    mixer.setWallCutaway(false);
    expect(mixer.getConfig().wallCutawayEnabled).toBe(false);
  });
});
