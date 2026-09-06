import { describe, expect, it } from "vitest";

import { STUDIO_BRUSH_RENDER_FAMILY } from "../studio-brush";

import {
  STUDIO_PAPER_BRUSH_RESPONSE,
  applyStudioPaperPhysicsToBrushResponse,
  resolveStudioPaperBrushEffectiveGranulation,
  resolveStudioPaperBrushResponse,
} from "./studio-paper-brush-response";
import {
  STUDIO_PAPER_GRANULATION_IDENTITY,
  normalizeStudioPaperGranulationSettings,
  resetStudioDocumentPaperSurface,
  setStudioDocumentPaperSurface,
  studioPaperGranulationEffectiveStrength,
  studioPaperGranulationIsActive,
} from "./studio-paper-granulation-runtime";

/** 정확한 항등이어야 하는 도구 — 잉크가 섬유를 물들이거나 물리적 종이가 없는 합성 마크. */
const IDENTITY_FAMILIES = [
  "airbrush",
  "pen",
  "gpen",
  "perfect",
  "marker",
  "highlighter",
  "neon",
  "glow",
  "glitter",
  "ink-particle",
  "screentone",
  "stamp",
  "pixel",
] as const;

describe("paper response policy", () => {
  it("covers every render family with an already normalized value", () => {
    for (const [family, response] of Object.entries(STUDIO_PAPER_BRUSH_RESPONSE)) {
      expect(normalizeStudioPaperGranulationSettings(response), family).toEqual(response);
    }
  });

  it("gives ink and technical tools an exact identity", () => {
    for (const family of IDENTITY_FAMILIES) {
      expect(STUDIO_PAPER_BRUSH_RESPONSE[family], family).toBe(
        STUDIO_PAPER_GRANULATION_IDENTITY,
      );
    }
    for (const brushId of ["technical-pen", "gpen", "maru-pen", "fineliner", "marker", "neon", "airbrush", "spray"]) {
      expect(studioPaperGranulationIsActive(resolveStudioPaperBrushResponse(brushId)), brushId)
        .toBe(false);
    }
  });

  it("ranks natural media by how much the paper actually shows", () => {
    const strength = (brushId: string) =>
      studioPaperGranulationEffectiveStrength(
        resolveStudioPaperBrushResponse(brushId, "cold-press"),
      );
    // 목탄 가루 > 파스텔 > 흑연 ≳ 수채 > 회화 붓 > 유성 > 에어브러시 > 잉크.
    expect(strength("charcoal")).toBeGreaterThan(strength("pastel"));
    expect(strength("pastel")).toBeGreaterThan(strength("pencil"));
    expect(strength("pencil")).toBeGreaterThan(strength("wet-wash-broad"));
    expect(strength("wet-wash-broad")).toBeGreaterThan(strength("brush"));
    expect(strength("brush")).toBeGreaterThan(strength("oil"));
    expect(strength("oil")).toBeGreaterThan(strength("calligraphy"));
    expect(strength("calligraphy")).toBeGreaterThan(strength("airbrush"));
    expect(strength("airbrush")).toBe(0);
  });

  it("keeps every authored strength below the mean-preserving ceiling", () => {
    for (const [family, response] of Object.entries(STUDIO_PAPER_BRUSH_RESPONSE)) {
      // 0.75를 넘으면 황목에서 알파 배수가 상한 2에 닿아 평균 보존이 깨진다
      // (studio-paper-granulation-runtime.test.ts가 그 경계를 실측으로 잡는다).
      expect(response.granulation, family).toBeLessThanOrEqual(0.7);
      expect(response.staining, family).toBeLessThanOrEqual(1);
    }
  });

  it("routes unknown and non-string ids to the identity rather than guessing", () => {
    for (const value of [undefined, null, 42, "", "totally-made-up-brush"]) {
      expect(resolveStudioPaperBrushResponse(value)).toBe(STUDIO_PAPER_GRANULATION_IDENTITY);
    }
  });

  it("follows the render-family map so pack/alias ids inherit their medium", () => {
    for (const [brushId, family] of Object.entries(STUDIO_BRUSH_RENDER_FAMILY)) {
      if ([
        "watercolor",
        "ink-wash",
        "inkwash-pen",
        "inkwash-water-brush",
        "inkwash-bleed-wash",
        "inkwash-white-ink",
      ].includes(brushId)) continue;
      const expected = applyStudioPaperPhysicsToBrushResponse(
        STUDIO_PAPER_BRUSH_RESPONSE[family],
        "cold-press",
      );
      expect(resolveStudioPaperBrushResponse(brushId, "cold-press"), brushId).toEqual(
        expected,
      );
    }
    expect(resolveStudioPaperBrushResponse("studio-charcoal-soft", "cold-press")).toEqual(
      applyStudioPaperPhysicsToBrushResponse(
        STUDIO_PAPER_BRUSH_RESPONSE["dry-media"],
        "cold-press",
      ),
    );
    expect(resolveStudioPaperBrushResponse("wet-wash-broad", "cold-press")).toEqual(
      applyStudioPaperPhysicsToBrushResponse(
        STUDIO_PAPER_BRUSH_RESPONSE.watercolor,
        "cold-press",
      ),
    );
  });

  it("keeps new core wet snapshots authoritative without changing persisted pack paper", () => {
    for (const brushId of [
      "watercolor",
      "ink-wash",
      "inkwash-pen",
      "inkwash-water-brush",
      "inkwash-bleed-wash",
      "inkwash-white-ink",
    ]) {
      expect(resolveStudioPaperBrushResponse(brushId), brushId).toBe(
        STUDIO_PAPER_GRANULATION_IDENTITY,
      );
    }
    expect(resolveStudioPaperBrushResponse("dry-media", "cold-press")).toEqual(
      applyStudioPaperPhysicsToBrushResponse(
        STUDIO_PAPER_BRUSH_RESPONSE["dry-media"],
        "cold-press",
      ),
    );
  });

  it("amplifies dry media on sanded/charcoal paper vs marker pad", () => {
    resetStudioDocumentPaperSurface();
    const onSanded = resolveStudioPaperBrushEffectiveGranulation("charcoal", "sanded-pastel");
    const onMarker = resolveStudioPaperBrushEffectiveGranulation("charcoal", "marker-pad");
    const onCanvas = resolveStudioPaperBrushEffectiveGranulation("oil", "canvas");
    const onBristol = resolveStudioPaperBrushEffectiveGranulation("oil", "bristol");
    expect(onSanded).toBeGreaterThan(onMarker * 1.8);
    expect(onCanvas).toBeGreaterThan(onBristol);
    setStudioDocumentPaperSurface({ kind: "sanded-pastel", seed: 3 });
    expect(resolveStudioPaperBrushEffectiveGranulation("pastel")).toBeGreaterThan(
      resolveStudioPaperBrushEffectiveGranulation("pastel", "bristol"),
    );
    resetStudioDocumentPaperSurface();
  });
});
