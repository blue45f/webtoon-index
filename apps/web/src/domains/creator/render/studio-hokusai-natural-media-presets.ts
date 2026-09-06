import {
  STUDIO_OSS_DRY_CARRIER_RECIPE,
  STUDIO_OSS_OIL_FILM_RECIPE,
} from "../studio-oss-brush-kernels";

import type {
  StudioHokusaiNaturalMediaPresetId,
} from "./studio-hokusai-natural-media-contract";

interface StudioHokusaiPresetSetting {
  readonly base_value: number;
  readonly inputs: Readonly<
    Record<string, readonly (readonly [number, number])[]>
  >;
}

function setting(
  baseValue: number,
  inputs: Readonly<Record<string, readonly (readonly [number, number])[]>> = {},
): StudioHokusaiPresetSetting {
  return { base_value: baseValue, inputs };
}

export function studioHokusaiNaturalMediaPresetSettings(
  presetId: StudioHokusaiNaturalMediaPresetId,
): Readonly<Record<string, StudioHokusaiPresetSetting>> {
  switch (presetId) {
    case "pencil":
      return {
        anti_aliasing: setting(1),
        // Small Studio pencil sizes used to collapse below one device pixel:
        // the pressure radius curve reduced the requested radius a second time,
        // then sparse antialiased dabs left an occasional transparent centre.
        // Keep enough overlap for a continuous graphite core while preserving
        // pressure taper at both ends of a stylus stroke.
        dabs_per_actual_radius: setting(9.5),
        dabs_per_basic_radius: setting(0.75),
        dabs_per_second: setting(55),
        direction_filter: setting(0.3),
        hardness: setting(0.78),
        opaque: setting(0.96, {
          pressure: [[0, -0.28], [0.2, -0.12], [0.45, 0], [1, 0.08]],
        }),
        opaque_linearize: setting(0.95),
        opaque_multiply: setting(0, {
          pressure: [[0, 0], [0.02, 0], [0.08, 0.92], [0.3, 1], [1, 1]],
        }),
        radius_by_random: setting(0.015),
        radius_logarithmic: setting(1, {
          pressure: [
            [0, -0.82],
            [0.15, -0.48],
            [0.35, -0.22],
            [0.55, -0.04],
            [0.8, 0.12],
            [1, 0.24],
          ],
        }),
        slow_tracking: setting(1.2),
        slow_tracking_per_dab: setting(0.5),
        tracking_noise: setting(0.012),
      };
    case "charcoal": {
      // libmypaint charcoal.myb DNA (STUDIO_OSS_DRY_CARRIER_RECIPE).
      const dry = STUDIO_OSS_DRY_CARRIER_RECIPE;
      return {
        anti_aliasing: setting(dry.antiAliasing),
        dabs_per_actual_radius: setting(dry.dabsPerActualRadius),
        dabs_per_basic_radius: setting(dry.dabsPerBasicRadius),
        elliptical_dab_ratio: setting(dry.ellipticalDabRatio),
        hardness: setting(dry.hardness, {
          pressure: [[0, -0.08], [1, 0.12]],
        }),
        offset_by_random: setting(dry.offsetByRandom, {
          pressure: [[0, 0.05], [1, -0.05]],
        }),
        opaque: setting(dry.opaque, {
          pressure: [[0, -0.22], [0.55, 0], [1, 0.14]],
        }),
        opaque_linearize: setting(dry.opaqueLinearize),
        opaque_multiply: setting(0, {
          pressure: [[0, 0], [0.02, 0.55], [0.12, 1], [1, 1]],
        }),
        radius_by_random: setting(dry.radiusByRandom),
        radius_logarithmic: setting(dry.radiusLogarithmic, {
          pressure: [[0, -0.28], [0.55, 0.02], [1, 0.38]],
        }),
        slow_tracking: setting(dry.slowTracking),
        tracking_noise: setting(dry.trackingNoise),
      };
    }
    case "oil": {
      // Hybrid: modelling + Wet_Paint_Plus hardness (OSS) + Hokusai paint_mode.
      const oil = STUDIO_OSS_OIL_FILM_RECIPE;
      return {
        anti_aliasing: setting(oil.antiAliasing),
        dabs_per_actual_radius: setting(oil.dabsPerActualRadius),
        dabs_per_basic_radius: setting(oil.dabsPerBasicRadius),
        direction_filter: setting(oil.directionFilter),
        elliptical_dab_angle: setting(0, {
          direction: [[0, 0], [180, 180]],
        }),
        elliptical_dab_ratio: setting(oil.ellipticalDabRatio, {
          pressure: [[0, -0.22], [0.45, -0.02], [1, 0.14]],
        }),
        hardness: setting(oil.hardness, {
          pressure: [[0, -0.14], [0.55, 0], [1, 0.12]],
        }),
        offset_by_random: setting(oil.offsetByRandom, {
          pressure: [[0, 0.02], [1, -0.02]],
        }),
        opaque: setting(oil.opaque, {
          pressure: [[0, -0.28], [0.35, -0.08], [0.7, 0.02], [1, 0.1]],
        }),
        opaque_linearize: setting(oil.opaqueLinearize),
        opaque_multiply: setting(0, {
          pressure: [[0, 0], [0.04, 0.22], [0.18, 0.78], [1, 1]],
        }),
        // Hokusai/libmypaint's canonical spectral-pigment switch is
        // `paint_mode`; the unknown `paint` key silently disables it.
        // Literal 0.88 kept for worker-boundary AST gate (= oil.paintMode).
        paint_mode: setting(0.88),
        radius_by_random: setting(oil.radiusByRandom),
        radius_logarithmic: setting(oil.radiusLogarithmic, {
          pressure: [[0, -0.28], [0.35, 0], [0.65, 0.24], [1, 0.62]],
        }),
        slow_tracking: setting(oil.slowTracking),
        slow_tracking_per_dab: setting(oil.slowTrackingPerDab),
        smudge: setting(oil.smudge),
        smudge_length: setting(oil.smudgeLength),
        smudge_length_log: setting(0.3),
      };
    }
    case "calligraphy":
      return {
        anti_aliasing: setting(1),
        dabs_per_actual_radius: setting(3.4),
        elliptical_dab_angle: setting(43, {
          direction: [[0, -4], [180, 4]],
        }),
        elliptical_dab_ratio: setting(4.8, {
          pressure: [[0, 1.4], [1, -1.2]],
        }),
        hardness: setting(0.78),
        opaque: setting(1),
        opaque_multiply: setting(0, {
          pressure: [[0, 0], [0.02, 0.8], [0.08, 1], [1, 1]],
        }),
        radius_logarithmic: setting(1.8, {
          pressure: [[0, -0.3], [1, 0.6]],
          speed1: [[0, 0], [1, -0.15]],
        }),
        slow_tracking: setting(0.65),
        slow_tracking_per_dab: setting(0.7),
      };
    case "marker":
      return {
        anti_aliasing: setting(0.9),
        dabs_per_actual_radius: setting(3),
        dabs_per_basic_radius: setting(1),
        elliptical_dab_angle: setting(108, {
          tilt_ascension: [[-180, -180], [180, 180]],
        }),
        elliptical_dab_ratio: setting(7.5, {
          tilt_declination: [[0, 0], [68, -6.5], [90, -6.5]],
        }),
        hardness: setting(0.96),
        opaque: setting(0.92, {
          pressure: [[0, -0.24], [0.25, -0.1], [0.65, 0.02], [1, 0.08]],
        }),
        opaque_linearize: setting(0.78),
        opaque_multiply: setting(0, {
          pressure: [[0, 0], [0.04, 0.75], [0.1, 1], [1, 1]],
        }),
        radius_logarithmic: setting(2.1, {
          pressure: [[0, -0.22], [0.45, -0.04], [1, 0.18]],
          tilt_declination: [[20, 0], [50, 0], [80, -0.8]],
        }),
        slow_tracking: setting(1.4),
      };
  }
}

export function studioHokusaiNaturalMediaPresetJson(
  presetId: StudioHokusaiNaturalMediaPresetId,
): string {
  return JSON.stringify({
    version: 3,
    group: "ToonSpectrum natural media",
    parent_brush_name: "",
    comment:
      `ToonSpectrum ${presetId} preset for Hokusai 0.3.0 · deterministic texture v2`,
    settings: studioHokusaiNaturalMediaPresetSettings(presetId),
  });
}
