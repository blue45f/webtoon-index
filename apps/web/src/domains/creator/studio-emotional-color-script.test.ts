import { describe, expect, it } from "vitest";

import {
  addEmotionalNode,
  createStudioEmotionalColorScript,
  updateEmotionalNode,
  validateEmotionalColorScript,
  type SceneEmotionalColorNode,
} from "./studio-emotional-color-script";

describe("Studio Emotional & Color Script Engine", () => {
  function makeNode(
    id: string,
    sequenceIndex: number,
    partial: Partial<SceneEmotionalColorNode> = {},
  ): SceneEmotionalColorNode {
    return {
      id,
      sceneId: `scene_${id}`,
      sceneTitle: `장면 ${id}`,
      sequenceIndex,
      emotions: { tension: 0.3, hope: 0.7, fear: 0.1, humor: 0.4 },
      palette: {
        primaryColor: "#3498db",
        secondaryColor: "#2ecc71",
        accentColor: "#f39c12",
        lightingTone: "warm-day",
        targetLuminance: 0.6,
        targetSaturation: 0.5,
      },
      pacing: {
        closeUpRatio: 0.3,
        panelDensity: 5,
        dialogueWordCount: 80,
        backgroundDetail: "standard",
      },
      ...partial,
    };
  }

  it("creates and sorts emotional script nodes", () => {
    const n2 = makeNode("n2", 2);
    const n1 = makeNode("n1", 1);
    const script = createStudioEmotionalColorScript({
      id: "es_1",
      episodeId: "ep_1",
      nodes: [n2, n1],
    });

    expect(script.nodes[0].id).toBe("n1");
    expect(script.nodes[1].id).toBe("n2");
  });

  it("clamps emotional and color values into 0..1 range", () => {
    const node = makeNode("n1", 1, {
      emotions: { tension: 1.5, hope: -0.2, fear: 0.5, humor: 0.5 },
      palette: {
        primaryColor: "#000",
        secondaryColor: "#111",
        accentColor: "#222",
        lightingTone: "cool-night",
        targetLuminance: 2.0,
        targetSaturation: -0.5,
      },
    });
    const script = createStudioEmotionalColorScript({ id: "es", episodeId: "ep", nodes: [node] });
    const clamped = script.nodes[0];

    expect(clamped.emotions.tension).toBe(1);
    expect(clamped.emotions.hope).toBe(0);
    expect(clamped.palette.targetLuminance).toBe(1);
    expect(clamped.palette.targetSaturation).toBe(0);
  });

  it("detects discordant color mood for extreme tension in high-key palette", () => {
    const node = makeNode("n_terror", 1, {
      emotions: { tension: 0.95, fear: 0.9, hope: 0.0, humor: 0.0 },
      palette: {
        primaryColor: "#fff",
        secondaryColor: "#eee",
        accentColor: "#ddd",
        lightingTone: "warm-day",
        targetLuminance: 0.95,
        targetSaturation: 0.95,
      },
    });
    const script = createStudioEmotionalColorScript({ id: "es", episodeId: "ep", nodes: [node] });
    const diags = validateEmotionalColorScript(script);

    expect(diags.some((d) => d.code === "DISCORDANT_COLOR_MOOD")).toBe(true);
  });

  it("detects abrupt tone jumps between adjacent scenes", () => {
    const n1 = makeNode("n1", 1, { emotions: { tension: 0.1, hope: 0.9, fear: 0.0, humor: 0.8 } });
    const n2 = makeNode("n2", 2, { emotions: { tension: 0.95, hope: 0.0, fear: 0.9, humor: 0.0 } });

    const script = createStudioEmotionalColorScript({ id: "es", episodeId: "ep", nodes: [n1, n2] });
    const diags = validateEmotionalColorScript(script);

    expect(diags.some((d) => d.code === "ABRUPT_TONE_JUMP")).toBe(true);
  });

  it("detects overcrowded pacing with excessive text and closeups", () => {
    const crowded = makeNode("n_crowded", 1, {
      pacing: {
        closeUpRatio: 0.9,
        panelDensity: 12,
        dialogueWordCount: 500,
        backgroundDetail: "hyper-detailed",
      },
    });
    const script = createStudioEmotionalColorScript({ id: "es", episodeId: "ep", nodes: [crowded] });
    const diags = validateEmotionalColorScript(script);

    expect(diags.some((d) => d.code === "OVERCROWDED_PACING")).toBe(true);
  });

  it("supports adding and updating nodes", () => {
    let script = createStudioEmotionalColorScript({ id: "es", episodeId: "ep" });
    const n1 = makeNode("n1", 1);
    script = addEmotionalNode(script, n1);
    expect(script.nodes).toHaveLength(1);

    script = updateEmotionalNode(script, "n1", { sceneTitle: "제목 변경" });
    expect(script.nodes[0].sceneTitle).toBe("제목 변경");
  });
});
