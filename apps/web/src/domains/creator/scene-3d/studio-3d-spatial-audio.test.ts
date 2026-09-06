import { describe, it, expect } from "vitest";

import { Studio3DSpatialAudioEngine } from "./studio-3d-spatial-audio";

describe("Studio3DSpatialAudioEngine", () => {
  it("initializes with default listener pose at head height (1.6m)", () => {
    const engine = new Studio3DSpatialAudioEngine();
    expect(engine.getListener().position[1]).toBe(1.6);
    expect(engine.getEmitters().length).toBe(0);
  });

  it("calculates inverse distance attenuation correctly", () => {
    const engine = new Studio3DSpatialAudioEngine({ position: [0, 0, 0] });
    engine.addEmitter({
      id: "emitter-1",
      label: "Boom",
      position: [0, 0, -2], // 2 meters in front
      orientation: [0, 0, 1],
      distanceModel: "inverse",
      refDistance: 1.0,
      maxDistance: 10.0,
      rolloffFactor: 1.0,
      coneInnerAngleDeg: 360,
      coneOuterAngleDeg: 360,
      coneOuterGain: 1.0,
      gain: 1.0,
      sfxPreset: "explosion-rumble",
    });

    const evaluated = engine.evaluateAllEmitters()[0];
    expect(evaluated.distanceMeters).toBeCloseTo(2.0, 3);
    // At dist 2 with ref 1: gain = 1 / (1 + 1*(2-1)) = 0.5
    expect(evaluated.effectiveGain).toBeCloseTo(0.5, 3);
    expect(evaluated.azimuthDeg).toBeCloseTo(0, 1); // Directly in front
  });

  it("calculates directional sound cone attenuation for focused speech/effects", () => {
    const engine = new Studio3DSpatialAudioEngine({ position: [0, 0, 0] });
    // Emitter positioned at [0, 0, -2], facing AWAY from listener (+Z forward from emitter points toward listener, -Z points away)
    engine.addEmitter({
      id: "focused-speech",
      label: "Speech",
      position: [0, 0, -2],
      orientation: [0, 0, -1], // Pointing away into distance
      distanceModel: "inverse",
      refDistance: 1.0,
      maxDistance: 10.0,
      rolloffFactor: 0.0, // No distance attenuation to isolate cone
      coneInnerAngleDeg: 30,
      coneOuterAngleDeg: 90,
      coneOuterGain: 0.2,
      gain: 1.0,
      sfxPreset: "whisper-intimate",
    });

    const evaluated = engine.evaluateAllEmitters()[0];
    // Listener is directly behind the cone (180 deg) -> should receive outerGain 0.2
    expect(evaluated.effectiveGain).toBeCloseTo(0.2, 2);
  });

  it("creates preset configurations with appropriate defaults", () => {
    const slash = Studio3DSpatialAudioEngine.createPresetConfig("s1", "sword-slash", [1, 2, 3]);
    expect(slash.label).toContain("검격");
    expect(slash.coneInnerAngleDeg).toBe(90);

    const whisper = Studio3DSpatialAudioEngine.createPresetConfig("w1", "whisper-intimate", [0, 1, 0]);
    expect(whisper.distanceModel).toBe("exponential");
    expect(whisper.refDistance).toBe(0.5);
  });
});
