import { describe, it, expect } from "vitest";

import { Studio3DAtmosphereEngine } from "./studio-3d-atmosphere-weather";

describe("Studio3DAtmosphereEngine", () => {
  it("initializes with golden-hour and provides all 12 atmosphere presets", () => {
    const engine = new Studio3DAtmosphereEngine();
    expect(engine.getActivePreset().id).toBe("golden-hour");

    const allPresets = Studio3DAtmosphereEngine.getAllPresets();
    expect(allPresets.length).toBe(12);

    const presetIds = allPresets.map((p) => p.id);
    expect(presetIds).toContain("clear-noon");
    expect(presetIds).toContain("golden-hour");
    expect(presetIds).toContain("dramatic-sunset");
    expect(presetIds).toContain("cyberpunk-neon-night");
    expect(presetIds).toContain("eerie-fog");
    expect(presetIds).toContain("rainy-drizzle");
    expect(presetIds).toContain("heavy-thunderstorm");
    expect(presetIds).toContain("gentle-snowfall");
    expect(presetIds).toContain("blizzard");
    expect(presetIds).toContain("cherry-blossom-spring");
    expect(presetIds).toContain("autumn-leaves");
    expect(presetIds).toContain("fantasy-celestial-aurora");
  });

  it("calculates sun direction vector correctly from azimuth and elevation", () => {
    // 90 deg elevation (zenith) should point straight up [0, 1, 0]
    const zenith = Studio3DAtmosphereEngine.calculateSunVector(0, 90);
    expect(zenith[0]).toBeCloseTo(0, 5);
    expect(zenith[1]).toBeCloseTo(1, 5);
    expect(zenith[2]).toBeCloseTo(0, 5);

    // 0 deg elevation, 0 deg azimuth (North Horizon) should point [0, 0, 1]
    const northHorizon = Studio3DAtmosphereEngine.calculateSunVector(0, 0);
    expect(northHorizon[0]).toBeCloseTo(0, 5);
    expect(northHorizon[1]).toBeCloseTo(0, 5);
    expect(northHorizon[2]).toBeCloseTo(1, 5);
  });

  it("computes Rayleigh scattering colors based on sun elevation angle", () => {
    const middaySky = Studio3DAtmosphereEngine.computeRayleighSkyColor(60);
    expect(middaySky.zenithColor).toBe("#1e5799");
    expect(middaySky.sunColor).toBe("#ffffff");

    const sunsetSky = Studio3DAtmosphereEngine.computeRayleighSkyColor(10);
    expect(sunsetSky.horizonColor).toContain("#ff");

    const nightSky = Studio3DAtmosphereEngine.computeRayleighSkyColor(-5);
    expect(nightSky.zenithColor).toBe("#050b14");
  });

  it("generates precipitation particles for rainy and snowy presets", () => {
    const engine = new Studio3DAtmosphereEngine("rainy-drizzle");
    const particles = engine.generatePrecipitationParticles([0, 2, 0]);

    expect(particles.count).toBe(600);
    expect(particles.positions.length).toBe(600 * 3);
    expect(particles.velocities.length).toBe(600 * 3);
    expect(particles.colors.length).toBe(600 * 4);
    expect(particles.sizes.length).toBe(600);

    // Negative Y velocity for falling rain
    expect(particles.velocities[1]).toBeLessThan(0);
  });

  it("handles zero particle count for clear skies safely", () => {
    const engine = new Studio3DAtmosphereEngine("clear-noon");
    const particles = engine.generatePrecipitationParticles([0, 0, 0]);

    expect(particles.count).toBe(0);
    expect(particles.positions.length).toBe(0);
  });
});
