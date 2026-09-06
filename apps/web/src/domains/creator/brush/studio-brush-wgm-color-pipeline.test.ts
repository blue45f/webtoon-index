import { describe, expect, it } from "vitest";

import { exportPageToSvg } from "../export/studio-svg-export";
import {
  mixStudioSpectralWgm,
  STUDIO_SPECTRAL_WGM_COLOR_MIX_PAINT_MODE,
  STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID,
} from "../studio-spectral-wgm-mix-v1";

import {
  serializeStudioBrushDynamicsSettingsCanonical,
  studioBrushDynamicsSettingsForBrushId,
} from "./studio-brush-dynamics";
import {
  resolveStudioBrushEngineLaneColorPigmentTuning,
  STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS,
} from "./studio-brush-engine-lane-catalog";
import {
  normalizeStudioBrushColorDynamicsSettings,
  resolveNormalizedStudioBrushDabColor,
  studioBrushColorDynamicsIsActive,
} from "./studio-brush-material-dynamics";

const WGM_LANE_ID = "oil-pastel--wgm-mix";
const SIBLING_LANE_ID = "oil-pastel--waxy-film";
const BLUE = "#002185";
const YELLOW = "#fcd300";

/** Exact copy of the resolver's hex parse: `parseInt(pair, 16) / 255` per channel. */
function hexToRgb01(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/** Exact copy of the resolver's serialization: round(clamp01(c)·255) per channel. */
function rgb01ToHex(rgb: readonly number[]): string {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * Spec copy of the shared deterministic unit hash (studio-brush-material-dynamics
 * `seededUnit`) so the tests below can predict the per-dab mix stream without
 * exporting renderer internals. Any drift here is a byte-compatibility break.
 */
function seededUnitReference(seed: number, index: number, salt: number): number {
  let value = (seed ^ Math.imul((index + 1) >>> 0, 0x9e37_79b1) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

const MIX_JITTER_SALT = 0xa511_e9b3;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function dabMixReference(
  strokeSeed: number,
  dabIndex: number,
  base: number,
  jitter: number,
): number {
  return clamp01(
    base + (seededUnitReference(strokeSeed, dabIndex, MIX_JITTER_SALT) * 2 - 1) * jitter,
  );
}

/** Historical linear foreground↔background lerp (the unpinned byte contract). */
function legacyLinearResolveReference(
  foreground: string,
  background: string,
  mix: number,
): string {
  const fg = hexToRgb01(foreground);
  const bg = hexToRgb01(background);
  return rgb01ToHex([
    fg[0] + (bg[0] - fg[0]) * mix,
    fg[1] + (bg[1] - fg[1]) * mix,
    fg[2] + (bg[2] - fg[2]) * mix,
  ]);
}

/**
 * Call-site contract: the resolver feeds `mixStudioSpectralWgm` with
 * `factor = 1 - mix` because libmypaint's `factor` weighs the FIRST colour.
 */
function wgmResolveReference(
  foreground: string,
  background: string,
  mix: number,
): string {
  const fg = hexToRgb01(foreground);
  const bg = hexToRgb01(background);
  const mixed = mixStudioSpectralWgm(
    { r: fg[0], g: fg[1], b: fg[2] },
    { r: bg[0], g: bg[1], b: bg[2] },
    1 - mix,
    STUDIO_SPECTRAL_WGM_COLOR_MIX_PAINT_MODE,
  );
  return rgb01ToHex([mixed.r, mixed.g, mixed.b]);
}

function hueDegrees(hex: string): number {
  const [r, g, b] = hexToRgb01(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 1e-9) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

function pinnedSettings(
  backgroundColor: string,
  foregroundBackgroundMix: number,
  foregroundBackgroundJitter: number,
) {
  return normalizeStudioBrushColorDynamicsSettings({
    backgroundColor,
    foregroundBackgroundMix,
    foregroundBackgroundJitter,
    pigmentMixProgramId: STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID,
  });
}

describe("engine-lane WGM colour pigment tuning (catalogue pin)", () => {
  it("pins the spectral-wgm-v1 program on oil-pastel--wgm-mix and nothing else", () => {
    const tuning = resolveStudioBrushEngineLaneColorPigmentTuning(WGM_LANE_ID);
    expect(tuning).not.toBeNull();
    expect(tuning?.pigmentMixProgramId).toBe(STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID);
    // Honesty policy: a pinned mixer with nothing to mix would be a fake label.
    expect(tuning!.foregroundBackgroundMix).toBeGreaterThan(0);
    expect(tuning!.foregroundBackgroundJitter).toBeGreaterThan(0);
    expect(tuning!.backgroundColor).toMatch(/^#[0-9a-f]{6}$/u);
    // The jitter deliberately clamps some dabs to mix 0: fully covering pure
    // pigment crumbs must remain part of the scumble (and of the catalogue
    // contract audit that expects the raw stroke colour to stay reachable).
    expect(tuning!.foregroundBackgroundJitter).toBeGreaterThan(
      tuning!.foregroundBackgroundMix,
    );

    for (const row of STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS) {
      if (row.id === WGM_LANE_ID) continue;
      expect(
        resolveStudioBrushEngineLaneColorPigmentTuning(row.id),
        `${row.id}: unexpected pigment tuning`,
      ).toBeNull();
    }
    expect(resolveStudioBrushEngineLaneColorPigmentTuning(null)).toBeNull();
    expect(resolveStudioBrushEngineLaneColorPigmentTuning(undefined)).toBeNull();
    expect(resolveStudioBrushEngineLaneColorPigmentTuning("")).toBeNull();
  });

  it("carries the catalogue tuning into the lane's runtime dynamics (exercised, not advertised)", () => {
    const tuning = resolveStudioBrushEngineLaneColorPigmentTuning(WGM_LANE_ID)!;
    const settings = studioBrushDynamicsSettingsForBrushId(WGM_LANE_ID);
    expect(settings).not.toBeNull();
    expect(settings!.colorDynamics).toEqual({
      backgroundColor: tuning.backgroundColor,
      foregroundBackgroundMix: tuning.foregroundBackgroundMix,
      foregroundBackgroundJitter: tuning.foregroundBackgroundJitter,
      hueJitter: 0,
      saturationJitter: 0,
      valueJitter: 0,
      pigmentMixProgramId: STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID,
    });
    expect(studioBrushColorDynamicsIsActive(settings!.colorDynamics)).toBe(true);
    const canonical = serializeStudioBrushDynamicsSettingsCanonical(settings);
    expect(canonical).toContain('"pigmentMixProgramId":"spectral-wgm-v1"');
  });

  it("keeps every other lane and core dry-media id off the pigment program (byte identity)", () => {
    const unpinnedIds = [
      ...STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS.map((row) => row.id).filter(
        (id) => id !== WGM_LANE_ID,
      ),
      "oil-pastel",
      "pastel",
      "crayon",
      "chalk",
      "charcoal",
      "dry-media",
    ];
    for (const id of unpinnedIds) {
      const settings = studioBrushDynamicsSettingsForBrushId(id);
      if (!settings) continue;
      expect(
        settings.colorDynamics.pigmentMixProgramId,
        `${id}: unexpected pigment program pin`,
      ).toBeUndefined();
      expect(serializeStudioBrushDynamicsSettingsCanonical(settings)).not.toContain(
        "pigmentMixProgramId",
      );
    }
    // The sibling lane shares the dry-media physics but keeps the legacy
    // all-zero colour pipeline byte-for-byte.
    const sibling = studioBrushDynamicsSettingsForBrushId(SIBLING_LANE_ID)!;
    expect(JSON.stringify(sibling.colorDynamics)).toBe(
      '{"backgroundColor":null,"foregroundBackgroundMix":0,"foregroundBackgroundJitter":0,"hueJitter":0,"saturationJitter":0,"valueJitter":0}',
    );
  });
});

describe("colour dynamics normalization with the pigment program pin", () => {
  it("keeps the legacy canonical JSON byte-stable when the pin is absent or invalid", () => {
    const legacy =
      '{"backgroundColor":null,"foregroundBackgroundMix":0,"foregroundBackgroundJitter":0,"hueJitter":0,"saturationJitter":0,"valueJitter":0}';
    expect(JSON.stringify(normalizeStudioBrushColorDynamicsSettings())).toBe(legacy);
    for (const hostile of [
      "spectral-wgm-v2",
      "SPECTRAL-WGM-V1",
      "studio-spectral-wgm-mix-v1",
      1,
      true,
      {},
      [],
      null,
    ]) {
      expect(
        JSON.stringify(
          normalizeStudioBrushColorDynamicsSettings({ pigmentMixProgramId: hostile }),
        ),
        `pin candidate ${String(hostile)} must fail closed`,
      ).toBe(legacy);
    }
  });

  it("admits exactly the spectral-wgm-v1 pin, appended after the legacy keys", () => {
    const normalized = normalizeStudioBrushColorDynamicsSettings({
      backgroundColor: YELLOW,
      foregroundBackgroundMix: 0.5,
      pigmentMixProgramId: STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID,
    });
    expect(JSON.stringify(normalized)).toBe(
      `{"backgroundColor":"${YELLOW}","foregroundBackgroundMix":0.5,"foregroundBackgroundJitter":0,"hueJitter":0,"saturationJitter":0,"valueJitter":0,"pigmentMixProgramId":"spectral-wgm-v1"}`,
    );
    // Idempotent across re-normalization (selection capture → persistence → render).
    expect(normalizeStudioBrushColorDynamicsSettings(normalized)).toEqual(normalized);
  });
});

describe("shared per-dab colour resolution with the WGM program", () => {
  it("mixes blue over yellow into green pigment (hue 70°–160°) at the mid mix", () => {
    const settings = pinnedSettings(YELLOW, 0.5, 0);
    for (const [dabIndex, strokeSeed] of [
      [0, 1],
      [7, 12_345],
      [4_096, 0xdead_beef],
    ] as const) {
      const resolved = resolveNormalizedStudioBrushDabColor(
        BLUE,
        dabIndex,
        strokeSeed,
        settings,
      );
      expect(resolved).toBe(wgmResolveReference(BLUE, YELLOW, 0.5));
      const hue = hueDegrees(resolved);
      expect(hue).toBeGreaterThan(70);
      expect(hue).toBeLessThan(160);
      const [r, g, b] = hexToRgb01(resolved);
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
      // The linear lerp of the same pair is grey mud, never this green.
      expect(resolved).not.toBe(legacyLinearResolveReference(BLUE, YELLOW, 0.5));
    }
  });

  it("keeps libmypaint factor semantics: foreground weighs 1 - mix (FIRST colour)", () => {
    // Endpoints survive the 10-band round trip to the exact byte.
    expect(resolveNormalizedStudioBrushDabColor(BLUE, 0, 1, pinnedSettings(YELLOW, 0, 0)))
      .toBe(BLUE);
    expect(resolveNormalizedStudioBrushDabColor(BLUE, 0, 1, pinnedSettings(YELLOW, 1, 0)))
      .toBe(YELLOW);
    for (const mix of [0.2, 0.5, 0.8]) {
      expect(
        resolveNormalizedStudioBrushDabColor(BLUE, 3, 99, pinnedSettings(YELLOW, mix, 0)),
      ).toBe(wgmResolveReference(BLUE, YELLOW, mix));
    }
    // A factor flip (weighing the background as the first colour) would swap
    // these dominance directions and break this regression.
    const low = hexToRgb01(
      resolveNormalizedStudioBrushDabColor(BLUE, 3, 99, pinnedSettings(YELLOW, 0.2, 0)),
    );
    const high = hexToRgb01(
      resolveNormalizedStudioBrushDabColor(BLUE, 3, 99, pinnedSettings(YELLOW, 0.8, 0)),
    );
    expect(low[2]).toBeGreaterThan(high[2]);
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(
      resolveNormalizedStudioBrushDabColor(BLUE, 3, 99, pinnedSettings(YELLOW, 0.2, 0)),
    ).not.toBe(wgmResolveReference(BLUE, YELLOW, 0.8));
  });

  it("leaves unpinned snapshots on the exact historical linear lerp bytes", () => {
    const unpinned = normalizeStudioBrushColorDynamicsSettings({
      backgroundColor: YELLOW,
      foregroundBackgroundMix: 0.42,
      foregroundBackgroundJitter: 0.31,
    });
    expect(unpinned.pigmentMixProgramId).toBeUndefined();
    for (let dabIndex = 0; dabIndex < 48; dabIndex += 1) {
      for (const strokeSeed of [1, 777, 0x1234_5678]) {
        const mix = dabMixReference(strokeSeed, dabIndex, 0.42, 0.31);
        expect(
          resolveNormalizedStudioBrushDabColor(BLUE, dabIndex, strokeSeed, unpinned),
          `unpinned dab ${dabIndex} seed ${strokeSeed}`,
        ).toBe(legacyLinearResolveReference(BLUE, YELLOW, mix));
      }
    }
    // The pin is the only switch: identical channels with the pin diverge.
    const pinned = pinnedSettings(YELLOW, 0.42, 0.31);
    expect(resolveNormalizedStudioBrushDabColor(BLUE, 5, 777, pinned)).not.toBe(
      resolveNormalizedStudioBrushDabColor(BLUE, 5, 777, unpinned),
    );
  });

  it("varies the lane's default scumble per dab deterministically and keeps pure pigment crumbs", () => {
    const lane = studioBrushDynamicsSettingsForBrushId(WGM_LANE_ID)!;
    const settings = lane.colorDynamics;
    const strokeSeed = 12_345;
    const resolveAll = () =>
      Array.from({ length: 64 }, (_, dabIndex) =>
        resolveNormalizedStudioBrushDabColor(BLUE, dabIndex, strokeSeed, settings),
      );
    const colors = resolveAll();
    expect(resolveAll()).toEqual(colors);
    expect(new Set(colors).size).toBeGreaterThan(8);
    // Zero-clamped mixes keep the exact foreground byte identity (full coverage).
    expect(colors).toContain(BLUE);
    // And non-zero mixes actually leave the foreground (the mixer is exercised).
    expect(colors.some((color) => color !== BLUE)).toBe(true);
    for (let dabIndex = 0; dabIndex < colors.length; dabIndex += 1) {
      const mix = dabMixReference(
        strokeSeed,
        dabIndex,
        settings.foregroundBackgroundMix,
        settings.foregroundBackgroundJitter,
      );
      expect(colors[dabIndex]).toBe(
        mix === 0 ? BLUE : wgmResolveReference(BLUE, settings.backgroundColor!, mix),
      );
    }
  });
});

describe("durable Canvas/SVG parity for the pinned lane", () => {
  function laneElement(brushId: string, colorDynamics: Record<string, unknown>) {
    const lane = studioBrushDynamicsSettingsForBrushId(brushId)!;
    return {
      width: 96,
      height: 64,
      bg: "#ffffff",
      transparentBg: true,
      elements: [
        {
          id: `wgm-parity-${brushId}`,
          type: "draw" as const,
          kind: "freehand" as const,
          mode: "pen" as const,
          brush: brushId,
          brushCatalogId: brushId,
          brushDynamics: { ...lane, colorDynamics },
          points: [10, 34, 24, 18, 42, 42, 62, 20, 82, 31],
          pressures: [0.35, 0.55, 0.8, 0.6, 0.42],
          stroke: BLUE,
          strokeWidth: 12,
          opacity: 0.9,
          sampleSpacing: 1,
        },
      ],
    };
  }

  it("serializes the WGM-mixed pigment colours into the SVG marks", () => {
    const input = laneElement(WGM_LANE_ID, {
      backgroundColor: YELLOW,
      foregroundBackgroundMix: 0.5,
      foregroundBackgroundJitter: 0,
      pigmentMixProgramId: STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID,
    });
    const first = exportPageToSvg(input);
    const second = exportPageToSvg(input);
    expect(first.elementCount).toBe(1);
    expect(first.skipped).toEqual([]);
    expect(first.svg).toBe(second.svg);
    const mixedHex = wgmResolveReference(BLUE, YELLOW, 0.5);
    // Both surfaces resolve the per-dab colour through the one shared
    // resolver, so the durable export must carry the same mixed pigment —
    // never the raw foreground, never the linear-lerp grey.
    expect(first.svg).toContain(mixedHex);
    expect(first.svg).not.toContain(BLUE);
    expect(first.svg).not.toContain(legacyLinearResolveReference(BLUE, YELLOW, 0.5));
  });

  it("keeps the unpinned sibling lane on the linear colour bytes in the same scenario", () => {
    const input = laneElement(SIBLING_LANE_ID, {
      backgroundColor: YELLOW,
      foregroundBackgroundMix: 0.5,
      foregroundBackgroundJitter: 0,
    });
    const exported = exportPageToSvg(input);
    expect(exported.elementCount).toBe(1);
    expect(exported.skipped).toEqual([]);
    expect(exported.svg).toContain(legacyLinearResolveReference(BLUE, YELLOW, 0.5));
    expect(exported.svg).not.toContain(wgmResolveReference(BLUE, YELLOW, 0.5));
  });
});
