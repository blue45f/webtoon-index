import { describe, expect, it } from "vitest";

import { STUDIO_ADJUSTMENT_ENGINE_IDS } from "../studio-adjustment-stack";

import {
  STUDIO_FILTER_CATALOG,
  STUDIO_FILTER_DIALOG_CATALOG,
  STUDIO_FILTER_GROUP_ORDER,
  searchStudioFilterCatalog,
  searchStudioFilterDialogCatalog,
  studioFilterDialogPreviewStyle,
} from "./studio-filter-catalog";
import { STUDIO_FILTER_MENU_KINDS } from "./studio-filter-menu";

describe("studio filter catalog", () => {
  it("covers every smart-filter engine exactly once", () => {
    const catalogIds = STUDIO_FILTER_CATALOG.map((entry) => entry.engine);
    expect(new Set(catalogIds).size).toBe(catalogIds.length);
    expect(catalogIds.length).toBeGreaterThanOrEqual(77);
    expect([...catalogIds].sort()).toEqual([...STUDIO_ADJUSTMENT_ENGINE_IDS].sort());
    for (const entry of STUDIO_FILTER_CATALOG) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(10);
      expect(entry.keywords.length).toBeGreaterThan(0);
      expect(STUDIO_FILTER_GROUP_ORDER).toContain(entry.group);
    }
  });

  it("searches Korean, English aliases, descriptions, and multiple terms locally", () => {
    expect(searchStudioFilterCatalog("감마").map((entry) => entry.engine))
      .toEqual(expect.arrayContaining(["levels", "exposure"]));
    expect(searchStudioFilterCatalog("dilate").map((entry) => entry.engine)).toEqual(["morphology"]);
    expect(searchStudioFilterCatalog("사용자 커널").map((entry) => entry.engine))
      .toEqual(["custom-convolution"]);
    expect(searchStudioFilterCatalog("구름 시드").map((entry) => entry.engine)).toEqual(["clouds"]);
    expect(searchStudioFilterCatalog("방사형 회전").map((entry) => entry.engine)).toEqual(["spin-blur"]);
    expect(searchStudioFilterCatalog("모자이크").map((entry) => entry.engine))
      .toEqual(["pixelate", "crystal-mosaic", "stained-glass"]);
    expect(searchStudioFilterCatalog("sobel").map((entry) => entry.engine))
      .toEqual(["line-extraction", "edge-detect", "poster-edges"]);
    expect(searchStudioFilterCatalog("cmyk 망점").map((entry) => entry.engine))
      .toEqual(["color-halftone"]);
    expect(searchStudioFilterCatalog("어안").map((entry) => entry.engine)).toEqual(["fisheye"]);
    expect(searchStudioFilterCatalog("복사기 먹선").map((entry) => entry.engine)).toEqual(["photocopy"]);
    expect(searchStudioFilterCatalog("스캔 선화 정리").map((entry) => entry.engine))
      .toContain("line-cleanup");
    expect(searchStudioFilterCatalog("망점 제거").map((entry) => entry.engine))
      .toEqual(["screentone-removal"]);
    expect(searchStudioFilterCatalog("deblock").map((entry) => entry.engine))
      .toEqual(["jpeg-artifact-reduction"]);
    expect(searchStudioFilterCatalog("색 경계 노이즈").map((entry) => entry.engine))
      .toContain("edge-aware-denoise");
    expect(searchStudioFilterCatalog("보케 조리개").map((entry) => entry.engine))
      .toEqual(["lens-blur"]);
    expect(searchStudioFilterCatalog("미니어처 초점 띠").map((entry) => entry.engine))
      .toEqual(["tilt-shift-blur"]);
    expect(searchStudioFilterCatalog("경계 보호 평활").map((entry) => entry.engine))
      .toEqual(["selective-gaussian-blur"]);
    expect(searchStudioFilterCatalog("반복 소재 이음매").map((entry) => entry.engine))
      .toEqual(["tileable-blur"]);
    expect(searchStudioFilterCatalog("스캔 복원 결함").map((entry) => entry.engine))
      .toEqual(["dust-scratches"]);
    expect(searchStudioFilterCatalog("dog 윤곽 추출").map((entry) => entry.engine))
      .toEqual(["difference-of-gaussians"]);
    expect(searchStudioFilterCatalog("paper removal").map((entry) => entry.engine))
      .toEqual(["color-to-alpha"]);
    expect(searchStudioFilterCatalog("노멀 맵").map((entry) => entry.engine)).toEqual(["normal-map"]);
  });

  it("honors an allowed-engine boundary without changing catalog order", () => {
    expect(searchStudioFilterCatalog("", ["clouds", "blur"]).map((entry) => entry.engine))
      .toEqual(["blur", "clouds"]);
  });

  it("covers every directly applicable dialog filter exactly once", () => {
    const kinds = STUDIO_FILTER_DIALOG_CATALOG.map((entry) => entry.kind);

    expect(new Set(kinds).size).toBe(kinds.length);
    expect([...kinds].sort()).toEqual([...STUDIO_FILTER_MENU_KINDS].sort());
    expect(kinds.length).toBeGreaterThanOrEqual(45);
  });

  it("searches dialog aliases and synthetic filter metadata without a network dependency", () => {
    expect(searchStudioFilterDialogCatalog("픽셀").map((entry) => entry.kind))
      .toContain("mosaic");
    expect(searchStudioFilterDialogCatalog("RGB 분리").map((entry) => entry.kind))
      .toEqual(expect.arrayContaining(["chromatic-aberration", "glitch"]));
    expect(searchStudioFilterDialogCatalog("CRT").map((entry) => entry.kind))
      .toEqual(["scanline"]);
    expect(searchStudioFilterDialogCatalog("투톤").map((entry) => entry.kind))
      .toEqual(["duotone"]);
    expect(searchStudioFilterDialogCatalog("스케치 정리").map((entry) => entry.kind))
      .toEqual(["line-cleanup"]);
    expect(searchStudioFilterDialogCatalog("링잉 제거").map((entry) => entry.kind))
      .toEqual(["jpeg-artifact-reduction"]);
    expect(searchStudioFilterDialogCatalog("아이리스 초점").map((entry) => entry.kind))
      .toEqual(["field-iris-blur"]);
  });

  it("builds deterministic copyright-free CSS previews for every dialog filter", () => {
    for (const entry of STUDIO_FILTER_DIALOG_CATALOG) {
      const first = studioFilterDialogPreviewStyle(entry);
      const second = studioFilterDialogPreviewStyle(entry);
      expect(first).toEqual(second);
      expect(first.background.length).toBeGreaterThan(20);
      expect(first.background).not.toMatch(/url\s*\(/iu);
      expect(first.background).not.toMatch(/https?:/iu);
    }
  });
});
