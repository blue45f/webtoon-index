import { describe, expect, it } from "vitest";

import {
  Studio3dParticleSystem,
  PARTICLE_VFX_PRESETS,
  type ParticleVfxPresetKind,
} from "./studio-3d-particle-system";

describe("Studio 3D Particle & Atmospheric VFX Engine", () => {
  it("provides all 7 essential webtoon VFX presets", () => {
    const expectedPresets: ParticleVfxPresetKind[] = [
      "sakura-petals",
      "magic-stardust",
      "rain-splashes",
      "snow-blizzard",
      "fire-embers",
      "action-speed-lines",
      "atmospheric-dust",
    ];

    for (const preset of expectedPresets) {
      expect(PARTICLE_VFX_PRESETS[preset]).toBeDefined();
      expect(PARTICLE_VFX_PRESETS[preset].maxParticles).toBeGreaterThan(0);
      expect(PARTICLE_VFX_PRESETS[preset].baseColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("simulates particles over time and cleans up expired particles", () => {
    const ps = new Studio3dParticleSystem("sakura-petals");
    expect(ps.getActiveParticles().length).toBe(0);

    // Update with 1 second
    ps.update(1.0);
    const active = ps.getActiveParticles();
    expect(active.length).toBeGreaterThan(0);

    // Initial position sanity
    expect(typeof active[0].posX).toBe("number");
    expect(typeof active[0].posY).toBe("number");
    expect(typeof active[0].posZ).toBe("number");

    // Advance time beyond max lifetime (e.g. 10s)
    ps.update(10.0);
    // Should still have freshly spawned particles bounded by maxParticles
    expect(ps.getActiveParticles().length).toBeLessThanOrEqual(
      PARTICLE_VFX_PRESETS["sakura-petals"].maxParticles
    );
  });

  it("allows switching presets dynamically", () => {
    const ps = new Studio3dParticleSystem("sakura-petals");
    ps.setPreset("fire-embers");
    expect(ps.getConfig().id).toBe("fire-embers");
    expect(ps.getConfig().gravity[1]).toBeGreaterThan(0); // Embers rise upward
  });
});
