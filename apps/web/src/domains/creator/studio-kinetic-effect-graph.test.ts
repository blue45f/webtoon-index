import { describe, expect, it } from "vitest";

import {
  addKineticEffect,
  createStudioKineticEffectGraph,
  generateStaticEffectFallback,
  removeKineticEffect,
  sampleKineticParticlesAtTime,
  type KineticEffectInstance,
} from "./studio-kinetic-effect-graph";

describe("Studio Kinetic Effect Graph", () => {
  const rainEffect: KineticEffectInstance = {
    id: "eff_rain_1",
    panelId: "panel_1",
    seed: 42,
    loopPeriodMs: 2000,
    bounds: { x: 0, y: 0, width: 800, height: 1200 },
    effect: {
      type: "rain",
      params: {
        speedPxPerSec: 500,
        angleDeg: 15,
        density: 0.8,
        streakLengthPx: 40,
      },
    },
  };

  const petalsEffect: KineticEffectInstance = {
    id: "eff_petals_1",
    panelId: "panel_2",
    seed: 123,
    loopPeriodMs: 3000,
    bounds: { x: 0, y: 0, width: 800, height: 1200 },
    effect: {
      type: "petals",
      params: {
        count: 20,
        windVelocityX: 100,
        windVelocityY: 150,
        flutterFrequencyHz: 2,
      },
    },
  };

  it("creates and manages effects in kinetic graph", () => {
    let graph = createStudioKineticEffectGraph({ id: "kg_1", episodeId: "ep_1" });
    expect(graph.effects).toHaveLength(0);

    graph = addKineticEffect(graph, rainEffect);
    expect(graph.effects).toHaveLength(1);

    graph = addKineticEffect(graph, petalsEffect);
    expect(graph.effects).toHaveLength(2);

    graph = removeKineticEffect(graph, "eff_rain_1");
    expect(graph.effects).toHaveLength(1);
    expect(graph.effects[0].id).toBe("eff_petals_1");
  });

  it("samples rain particles deterministically across time", () => {
    const pT0 = sampleKineticParticlesAtTime(rainEffect, 0);
    const pT500 = sampleKineticParticlesAtTime(rainEffect, 500);
    const pT2000 = sampleKineticParticlesAtTime(rainEffect, 2000); // 1 full loop

    expect(pT0.length).toBeGreaterThan(0);
    expect(pT0.length).toBe(pT500.length);

    // Positions change across time
    expect(pT0[0].y).not.toBe(pT500[0].y);

    // Loop period is 2000ms -> t=2000 should wrap around exactly to t=0
    expect(pT2000[0].y).toBeCloseTo(pT0[0].y, 3);
  });

  it("samples petals particles with fluttering", () => {
    const petals = sampleKineticParticlesAtTime(petalsEffect, 500);
    expect(petals).toHaveLength(20);
    expect(petals[0].scale).toBeGreaterThan(0.5);
    expect(petals[0].angleDeg).toBeDefined();
  });

  it("generates static effect fallback snapshot for print/PDF export", () => {
    const fallback = generateStaticEffectFallback(rainEffect);
    expect(fallback.particleSnapshot.length).toBeGreaterThan(0);
    expect(fallback.description).toContain("정적 렌더링용");
  });
});
