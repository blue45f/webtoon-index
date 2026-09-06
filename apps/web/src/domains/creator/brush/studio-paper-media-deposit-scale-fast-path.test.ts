import { describe, expect, it } from "vitest";

import {
  resolveStudioDryMediaKernelTipAlphaMap,
  STUDIO_DRY_MEDIA_KERNEL_TIP_VERSION,
} from "./studio-dry-media-kernel-tip";
import {
  getStudioPaperPresetV1,
  resolveStudioPaperDepositScaleV1,
  resolveStudioPaperMediaModulationV1,
  STUDIO_PAPER_MEDIA_MODULATION_IDENTITY_V1,
  type StudioPaperMediumV1,
  type StudioPaperPresetIdV1,
} from "./studio-paper-media-profile-v1";

/**
 * Adversarial-review regression (Lens 3, minor — stamp hot-path allocation).
 *
 * Probe being reproduced: `stampPaperDepositScale` built a fresh options object per dab and
 * `resolveStudioPaperMediaModulationV1` returned a new `Object.freeze({...})` per dab, of
 * which the stamp planner reads only `.depositScale` — two short-lived objects plus a freeze
 * call for every dab, thousands per long stroke, pure GC churn. The kernel-tip cache-hit path
 * additionally rebuilt its template-literal cache key per dab.
 *
 * The fix adds an allocation-free scalar fast path (`resolveStudioPaperDepositScaleV1`) that
 * shares ONE deposit-math source with the object path, and interns the closed kernel-tip key
 * space behind a numeric composite. These tests pin byte-identity: the scalar path must equal
 * the object path's depositScale bit-for-bit on an exhaustive medium × preset × pressure ×
 * position × thinness sweep, and kernel-tip revisions keep their exact pre-fix string layout.
 * Before the fix the scalar export did not exist (and nothing pinned the two paths together).
 */

const MEDIA: readonly StudioPaperMediumV1[] = [
  "crayon",
  "chalk",
  "charcoal",
  "pastel",
  "pencil",
  "dry-media",
  "watercolor",
  "ink-wash",
  "oil",
  "acrylic",
  "marker",
  "airbrush",
];

const PRESET_IDS: readonly StudioPaperPresetIdV1[] = [
  "watercolor-rough",
  "watercolor-hot-press",
  "kent",
  "canvas-weave",
  "newsprint",
  "printmaking",
];

const PRESSURES = [0, 0.13, 0.42, 0.5, 0.77, 1, 1.4, -0.2] as const;
const THINNESS_CASES = [undefined, 0, 0.4, 1] as const;
const SEED = 0x7a9e_1103;

describe("paper depositScale scalar fast path — byte identity with the modulation object path", () => {
  it("matches the object path bit-for-bit across every medium, preset, pressure, position and thinness", () => {
    let comparisons = 0;
    for (const medium of MEDIA) {
      for (const presetId of PRESET_IDS) {
        const preset = getStudioPaperPresetV1(presetId);
        for (const pressure of PRESSURES) {
          for (const thinness of THINNESS_CASES) {
            for (let cell = 0; cell < 9; cell += 1) {
              const x = 3.7 + (cell % 3) * 41.3;
              const y = 11.9 + Math.floor(cell / 3) * 27.7;
              const object = resolveStudioPaperMediaModulationV1({
                medium,
                preset,
                pressure,
                ...(thinness === undefined ? {} : { thinness }),
                x,
                y,
                seed: SEED,
              });
              const scalar = resolveStudioPaperDepositScaleV1(
                medium,
                preset,
                pressure,
                x,
                y,
                SEED,
                thinness,
              );
              expect(
                Object.is(scalar, object.depositScale),
                `${medium}/${presetId} p=${pressure} thin=${String(thinness)} @(${x},${y})`,
              ).toBe(true);
              comparisons += 1;
            }
          }
        }
      }
    }
    // 12 media × 6 presets × 8 pressures × 4 thinness cases × 9 positions.
    expect(comparisons).toBe(20_736);
  });

  it("fail-closes invalid inputs to the identity deposit scale exactly like the object path", () => {
    const preset = getStudioPaperPresetV1("kent");
    expect(
      resolveStudioPaperDepositScaleV1("no-such-medium", preset, 0.5, 1, 2, SEED),
    ).toBe(STUDIO_PAPER_MEDIA_MODULATION_IDENTITY_V1.depositScale);
    expect(
      resolveStudioPaperDepositScaleV1("crayon", preset, Number.NaN, 1, 2, SEED),
    ).toBe(STUDIO_PAPER_MEDIA_MODULATION_IDENTITY_V1.depositScale);
    expect(
      resolveStudioPaperDepositScaleV1(
        "crayon",
        null as unknown as ReturnType<typeof getStudioPaperPresetV1>,
        0.5,
        1,
        2,
        SEED,
      ),
    ).toBe(STUDIO_PAPER_MEDIA_MODULATION_IDENTITY_V1.depositScale);
  });
});

describe("kernel-tip cache key interning — revision layout and hit identity", () => {
  it("keeps the exact content-stable revision string layout after interning", () => {
    const tip = { shape: "grain", softness: 0.4 } as never;
    const crayon = resolveStudioDryMediaKernelTipAlphaMap("crayon", tip, 0, 1);
    // VERSION:material:variant:hardnessStep:widthStep — hardness 0.4 → round(0.6×20)=12,
    // banded crayon at full deposition alpha → width step 8.
    expect(crayon.revision).toBe(
      `${STUDIO_DRY_MEDIA_KERNEL_TIP_VERSION}:crayon:0:12:8`,
    );
    const charcoal = resolveStudioDryMediaKernelTipAlphaMap("charcoal", tip, 2, 0.4);
    // Non-banded charcoal always uses the fixed non-banded width step (8).
    expect(charcoal.revision).toBe(
      `${STUDIO_DRY_MEDIA_KERNEL_TIP_VERSION}:charcoal:2:12:8`,
    );
  });

  it("returns the identical cached map instance for repeated per-dab resolutions", () => {
    const tip = { shape: "grain", softness: 0.4 } as never;
    const first = resolveStudioDryMediaKernelTipAlphaMap("pastel", tip, 1, 0.8);
    const second = resolveStudioDryMediaKernelTipAlphaMap("pastel", tip, 1, 0.8);
    expect(second).toBe(first);
  });
});
