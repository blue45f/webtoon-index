import { describe, expect, it } from "vitest";

import {
  buildStudioBrushTipAlphaMap,
  decodeStudioBrushTipAlphaMapBase64,
  normalizeStudioBrushTipSettings,
  STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE,
} from "./brush/studio-brush-tip-stamp";
import {
  listStudioCc0KritaRgbaTipImports,
  resolveStudioCc0KritaRgbaTipImport,
  resolveStudioCc0KritaRgbaTipSettings,
  STUDIO_CC0_KRITA_RGBA_TIP_ALPHA_MAP_SIZE,
  STUDIO_CC0_KRITA_RGBA_TIP_IMPORTS,
  STUDIO_CC0_KRITA_RGBA_TIP_PROVENANCE,
} from "./studio-cc0-krita-rgba-tip-import-v1";

function decodedAlphas(tipId: string): Uint8Array {
  const entry = resolveStudioCc0KritaRgbaTipImport(tipId);
  expect(entry).not.toBeNull();
  const decoded = decodeStudioBrushTipAlphaMapBase64(entry!.alphaMapBase64);
  expect(decoded).not.toBeNull();
  return decoded!;
}

function meanOf(values: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index]!;
  return sum / Math.max(1, values.length);
}

describe("studio-cc0-krita-rgba-tip-import-v1", () => {
  it("ships three CC0 tips with exact bundle provenance", () => {
    const imports = listStudioCc0KritaRgbaTipImports();
    expect(imports).toHaveLength(3);
    expect(STUDIO_CC0_KRITA_RGBA_TIP_PROVENANCE.license).toContain("CC0-1.0");
    expect(STUDIO_CC0_KRITA_RGBA_TIP_PROVENANCE.bundle).toContain("RGBA_brushes.bundle");
    const ids = imports.map((entry) => entry.tipId);
    expect(new Set(ids).size).toBe(3);
    for (const entry of imports) {
      expect(entry.upstreamFile).toMatch(/^brushes\/.+\.png$/u);
      expect(entry.nameKo).toContain("Krita CC0");
      expect(entry.alphaMapSize).toBe(STUDIO_CC0_KRITA_RGBA_TIP_ALPHA_MAP_SIZE);
      expect(entry.alphaMapSize).toBeLessThanOrEqual(STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE);
    }
  });

  it("decodes every payload to exactly 64×64 bytes with real texture variance", () => {
    for (const entry of STUDIO_CC0_KRITA_RGBA_TIP_IMPORTS) {
      const alphas = decodedAlphas(entry.tipId);
      expect(alphas.length).toBe(64 * 64);
      const mean = meanOf(alphas) / 255;
      expect(mean, `${entry.tipId}: empty tip`).toBeGreaterThan(0.03);
      expect(mean, `${entry.tipId}: saturated tip`).toBeLessThan(0.85);
      let varianceSum = 0;
      let peak = 0;
      for (let index = 0; index < alphas.length; index += 1) {
        const value = alphas[index]! / 255;
        varianceSum += (value - mean) ** 2;
        peak = Math.max(peak, value);
      }
      // 진짜 임파스토/그레인 질감: 평판 원판(분산≈0)이 아니어야 하고, 최대값 정규화 유지.
      expect(varianceSum / alphas.length, `${entry.tipId}: flat tip`).toBeGreaterThan(0.01);
      expect(peak).toBe(1);
    }
  });

  it("keeps the three tips pairwise distinct", () => {
    const maps = STUDIO_CC0_KRITA_RGBA_TIP_IMPORTS.map((entry) => decodedAlphas(entry.tipId));
    for (let a = 0; a < maps.length; a += 1) {
      for (let b = a + 1; b < maps.length; b += 1) {
        let difference = 0;
        for (let index = 0; index < maps[a]!.length; index += 1) {
          difference += Math.abs(maps[a]![index]! - maps[b]![index]!) / 255;
        }
        expect(difference / maps[a]!.length).toBeGreaterThan(0.05);
      }
    }
  });

  it("is consumable by the custom alpha-map tip pipeline as-is", () => {
    for (const entry of STUDIO_CC0_KRITA_RGBA_TIP_IMPORTS) {
      const settings = resolveStudioCc0KritaRgbaTipSettings(entry.tipId);
      expect(settings).not.toBeNull();
      // 문서 경계 정규화가 payload 를 유효한 커스텀 맵으로 받아들여야 한다(64² 캡 포함).
      const normalized = normalizeStudioBrushTipSettings(settings);
      expect(normalized.alphaMapBase64).not.toBeNull();
      expect(normalized.alphaMapSize).toBe(64);
      const map = buildStudioBrushTipAlphaMap(settings);
      expect(map.custom).toBe(true);
      expect(map.size).toBe(64);
      expect(map.alphas.length).toBe(64 * 64);
      // 커스텀 맵이 절차 팁을 실제로 대체했는지: 절차 라운드 팁과 달라야 한다.
      const procedural = buildStudioBrushTipAlphaMap({ shape: "hard", softness: 0 });
      let difference = 0;
      const grid = Math.min(map.size, procedural.size);
      for (let index = 0; index < grid; index += 1) {
        difference += Math.abs(
          (map.alphas[index * map.size + index] ?? 0)
          - (procedural.alphas[index * procedural.size + index] ?? 0),
        );
      }
      expect(difference).toBeGreaterThan(0);
    }
    expect(resolveStudioCc0KritaRgbaTipSettings("unknown-tip")).toBeNull();
    expect(resolveStudioCc0KritaRgbaTipImport(null)).toBeNull();
  });

  it("payload constants are stable (deterministic import surface)", () => {
    for (const entry of STUDIO_CC0_KRITA_RGBA_TIP_IMPORTS) {
      const again = resolveStudioCc0KritaRgbaTipImport(entry.tipId)!;
      expect(again.alphaMapBase64).toBe(entry.alphaMapBase64);
      expect(resolveStudioCc0KritaRgbaTipSettings(entry.tipId)).toEqual(
        resolveStudioCc0KritaRgbaTipSettings(entry.tipId),
      );
    }
  });
});
