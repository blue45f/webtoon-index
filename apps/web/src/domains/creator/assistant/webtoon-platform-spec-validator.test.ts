import { describe, expect, it } from "vitest";

import { EXPORT_PRESETS, type ExportFormat } from "../export/studio-export-presets";
import { STUDIO_PUBLISH_PLATFORM_PRESETS } from "../studio-publish-package";

import {
  WEBTOON_CANVAS_THUMBNAIL_SPECS,
  WEBTOON_PLATFORM_SPECS,
  WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE,
  WebtoonPlatformSpecValidator,
  type WebtoonImageFormat,
  type WebtoonPlatformId,
} from "./webtoon-platform-spec-validator";

const ALL_PLATFORM_IDS = Object.keys(WEBTOON_PLATFORM_SPECS) as WebtoonPlatformId[];

describe("WebtoonPlatformSpecValidator", () => {
  const validator = new WebtoonPlatformSpecValidator();

  describe("provenance", () => {
    it("populates a source, confidence, and check date for every field of every spec row", () => {
      for (const id of ALL_PLATFORM_IDS) {
        const spec = WEBTOON_PLATFORM_SPECS[id];
        for (const field of ["width", "height", "size", "format", "gutter"] as const) {
          const p = spec.provenance[field];
          expect(p, `${id}.${field}`).toBeDefined();
          expect(["official", "third-party", "unverified"], `${id}.${field}`).toContain(p.confidence);
          expect(["platform-rule", "craft-guidance"], `${id}.${field}`).toContain(p.kind);
          expect(p.source.trim().length, `${id}.${field} source`).toBeGreaterThan(0);
          expect(p.checkedOn, `${id}.${field} checkedOn`).toBe(WEBTOON_PLATFORM_SPEC_SNAPSHOT_DATE);
        }
      }
    });

    it("requires a URL on every official platform rule, and on every episode budget and thumbnail", () => {
      for (const id of ALL_PLATFORM_IDS) {
        const spec = WEBTOON_PLATFORM_SPECS[id];
        for (const field of ["width", "height", "size", "format"] as const) {
          const p = spec.provenance[field];
          if (p.confidence === "official") {
            expect(p.url, `${id}.${field} official source must be linkable`).toBeTruthy();
          }
        }
        if (spec.episodeBudget) {
          expect(spec.episodeBudget.provenance.source.length, `${id} episodeBudget`).toBeGreaterThan(0);
        }
        for (const thumb of spec.thumbnails) {
          expect(thumb.provenance.source.length, `${id} thumbnail ${thumb.slot}`).toBeGreaterThan(0);
        }
      }
    });

    it("never grades a violation of an unverified rule as fail", () => {
      // 탑툰 규격은 1차 출처를 확보하지 못했다. 근거 없는 숫자로 원고를 막아서는 안 된다.
      const result = validator.audit("toptoon", {
        width: 999,
        height: 999_999,
        estimatedSizeBytes: 40 * 1024 * 1024,
        format: "gif",
      });

      expect(result.issues.some((i) => i.grade === "fail")).toBe(false);
      expect(result.isCompliant).toBe(true);
      expect(result.overallGrade).toBe("warn");
      expect(result.issues.some((i) => i.field === "provenance")).toBe(true);
    });

    it("surfaces the WEBTOON CANVAS episode-thumbnail documentation conflict with both values", () => {
      const result = validator.audit("webtoon-canvas", { width: 800, height: 1280 });
      const conflict = result.issues.find((i) => i.field === "provenance");

      expect(conflict).toBeDefined();
      expect(conflict?.grade).toBe("warn");
      expect(conflict?.message).toContain("202 x 142");
      expect(conflict?.message).toContain("160 x 151");
    });

    it("tags every issue message with the source behind the judgement", () => {
      const result = validator.audit("naver-webtoon", {
        width: 700,
        height: 30_000,
        format: "png",
        panelGuttersPx: [40],
      });

      expect(result.issues.length).toBeGreaterThan(0);
      for (const issue of result.issues) {
        expect(issue.message, issue.field).toContain("[");
        expect(issue.provenance.source.length).toBeGreaterThan(0);
      }
    });

    it("never grades an issue more severely than the rule itself asked for", () => {
      const severity = { pass: 0, warn: 1, fail: 2 } as const;
      for (const id of ALL_PLATFORM_IDS) {
        const result = validator.audit(id, {
          width: 1,
          height: 10_000_000,
          estimatedSizeBytes: 999 * 1024 * 1024,
          format: "gif",
          panelGuttersPx: [1, 99_999],
          episodeTotalBytes: 999 * 1024 * 1024,
          episodeImageCount: 9_999,
        });
        for (const issue of result.issues) {
          expect(severity[issue.grade], `${id}.${issue.field}`).toBeLessThanOrEqual(
            severity[issue.ruleSeverity],
          );
        }
      }
    });
  });

  describe("canvas audit", () => {
    it("passes a compliant WEBTOON CANVAS tile apart from the documented thumbnail conflict", () => {
      const result = validator.audit("webtoon-canvas", {
        width: 800,
        height: 1280,
        estimatedSizeBytes: 1.5 * 1024 * 1024,
        format: "png",
        panelGuttersPx: [250, 300, 800],
        episodeTotalBytes: 18 * 1024 * 1024,
        episodeImageCount: 40,
      });

      expect(result.isCompliant).toBe(true);
      // 문서 간 불일치 안내는 issues 에 남지만 등급은 오염시키지 않는다.
      expect(result.overallGrade).toBe("pass");
      expect(result.summary).toContain("규격 출처 주의");
      expect(result.issues.some((i) => i.field === "provenance")).toBe(true);
      // PNG는 공식 문서상 허용된다 — 종전 표의 "JPG 전용"은 공식 규격과 어긋났다.
      expect(result.issues.some((i) => i.field === "format")).toBe(false);
      expect(result.issues.some((i) => i.field === "width")).toBe(false);
      expect(result.issues.some((i) => i.field === "gutter")).toBe(false);
      expect(result.recommendedSliceCount).toBe(1);
    });

    it("fails a near-miss width on a single-width platform instead of warning", () => {
      // 종전 구현은 ±20px 허용치를 단일 폭 플랫폼에도 적용해, "가로 800px 엄격 제한"이라
      // 안내하면서 790px 를 통과(warn·compliant)시켰다.
      const result = validator.audit("webtoon-canvas", { width: 790, height: 1280 });
      const width = result.issues.find((i) => i.field === "width");

      expect(width?.grade).toBe("fail");
      expect(result.isCompliant).toBe(false);
    });

    it("keeps the ±20px tolerance on a platform that genuinely allows several widths", () => {
      // 레진은 폭 선택지가 두 개(1280/1440)라 허용치가 의미가 있다. 다만 출처가 교차 확인되지
      // 않아 최종 grade 는 둘 다 warn 으로 눌리므로, 규칙 자체의 심각도로 허용치를 확인한다.
      const near = validator.audit("lezhin-comics", { width: 1450, height: 12_000 });
      expect(near.issues.find((i) => i.field === "width")?.ruleSeverity).toBe("warn");

      const far = validator.audit("lezhin-comics", { width: 1000, height: 12_000 });
      expect(far.issues.find((i) => i.field === "width")?.ruleSeverity).toBe("fail");
      expect(far.issues.find((i) => i.field === "width")?.grade).toBe("warn");
    });

    it("caps an uncorroborated third-party rule at warn while reporting the rule's own severity", () => {
      const result = validator.audit("kakao-page", { width: 640, height: 1100 });
      const width = result.issues.find((i) => i.field === "width");

      expect(width?.ruleSeverity).toBe("fail");
      expect(width?.grade).toBe("warn");
      expect(result.isCompliant).toBe(true);
    });

    it("still fails a corroborated third-party rule", () => {
      // 690px 고정 폭은 외부 정리본 외에 네이버 공모전 요강·KOMACON 자료로도 확인됐다.
      const result = validator.audit("naver-webtoon", { width: 640, height: 1280 });
      const width = result.issues.find((i) => i.field === "width");

      expect(width?.provenance.corroborated).toBe(true);
      expect(width?.grade).toBe("fail");
      expect(result.isCompliant).toBe(false);
    });

    it("reports a low-confidence format denial as a warning that says the source is unverified", () => {
      // 네이버 도전만화의 PNG 거부는 외부 정리본 한 곳에서만 나온 저신뢰 정보다.
      const result = validator.audit("naver-webtoon", { width: 690, height: 1280, format: "png" });
      const format = result.issues.find((i) => i.field === "format");

      expect(format).toBeDefined();
      expect(format?.ruleSeverity).toBe("fail");
      expect(format?.grade).toBe("warn");
      expect(format?.provenance.corroborated).toBeUndefined();
      expect(format?.message).toContain("저신뢰");
      expect(format?.message).toContain("toonslicer.com");
      expect(format?.recommendation).toContain("공식 공지로 직접 확인");
      expect(result.isCompliant).toBe(true);
    });

    it("interpolates the platform's own thresholds into the gutter guidance", () => {
      const spec = WEBTOON_PLATFORM_SPECS["webtoon-canvas"];
      const result = validator.audit("webtoon-canvas", {
        width: 800,
        height: 1280,
        panelGuttersPx: [40, 4000],
      });
      const gutters = result.issues.filter((i) => i.field === "gutter");

      expect(gutters.length).toBe(2);
      expect(gutters[0].recommendation).toContain(`${spec.minGutterPx}px`);
      expect(gutters[1].recommendation).toContain(`${spec.maxGutterPx}px`);
      // 종전 문구는 임계값(100/120px, 900/1000px)과 다른 숫자(150~300px, 800px)를 권했다.
      expect(gutters[0].recommendation).not.toContain("150~300px");
      expect(gutters[1].recommendation).not.toContain("800px 이내");
    });
  });

  describe("episode-level budgets", () => {
    it("flags a WEBTOON CANVAS episode that busts the 20MB total while every image is legal", () => {
      const result = validator.audit("webtoon-canvas", {
        width: 800,
        height: 1280,
        estimatedSizeBytes: 1.9 * 1024 * 1024, // 장별로는 2MB 한도 안쪽
        format: "jpg",
        episodeTotalBytes: 24 * 1024 * 1024,
      });

      expect(result.issues.some((i) => i.field === "size")).toBe(false);
      const episode = result.issues.find((i) => i.field === "episode-size");
      expect(episode?.grade).toBe("fail");
      expect(result.isCompliant).toBe(false);
    });

    it("flags a WEBTOON CANVAS episode over the 100-image cap as its own issue", () => {
      const result = validator.audit("webtoon-canvas", {
        width: 800,
        height: 1280,
        episodeImageCount: 140,
        episodeTotalBytes: 10 * 1024 * 1024,
      });

      expect(result.issues.some((i) => i.field === "episode-size")).toBe(false);
      expect(result.issues.find((i) => i.field === "episode-count")?.grade).toBe("fail");
    });

    it("applies the Tapas 20MB episode budget and leaves height uncapped", () => {
      const spec = WEBTOON_PLATFORM_SPECS.tapas;
      expect(spec.hasPlatformHeightCap).toBe(false);
      expect(spec.episodeBudget?.maxEpisodeBytes).toBe(20 * 1024 * 1024);
      expect(spec.episodeBudget?.maxImageCount).toBeUndefined();

      const result = validator.audit("tapas", {
        width: 940,
        height: 9_000,
        episodeTotalBytes: 25 * 1024 * 1024,
      });
      expect(result.issues.some((i) => i.field === "height")).toBe(false);
      expect(result.issues.find((i) => i.field === "episode-size")?.grade).toBe("fail");
    });
  });

  describe("thumbnail specs", () => {
    it("carries all three WEBTOON CANVAS thumbnail slots with their byte ceilings", () => {
      const bySlot = Object.fromEntries(WEBTOON_CANVAS_THUMBNAIL_SPECS.map((t) => [t.slot, t]));

      expect(bySlot["series-square"]).toMatchObject({ widthPx: 1080, heightPx: 1080 });
      expect(bySlot["series-square"].maxBytesExclusive).toBe(500 * 1024);
      expect(bySlot["series-vertical"]).toMatchObject({ widthPx: 1080, heightPx: 1920 });
      expect(bySlot["series-vertical"].maxBytesExclusive).toBe(700 * 1024);
      expect(bySlot.episode).toMatchObject({ widthPx: 202, heightPx: 142 });
      expect(bySlot.episode.maxBytesExclusive).toBe(500 * 1024);
    });

    it("passes a correct thumbnail and treats the byte ceiling as exclusive", () => {
      const under = validator.auditThumbnail("webtoon-canvas", "series-square", {
        width: 1080,
        height: 1080,
        sizeBytes: 500 * 1024 - 1,
      });
      expect(under?.overallGrade).toBe("pass");

      const atLimit = validator.auditThumbnail("webtoon-canvas", "series-square", {
        width: 1080,
        height: 1080,
        sizeBytes: 500 * 1024,
      });
      expect(atLimit?.overallGrade).toBe("fail");
    });

    it("warns about the conflicting episode-thumbnail documents before judging the size", () => {
      const result = validator.auditThumbnail("webtoon-canvas", "episode", {
        width: 160,
        height: 151,
      });

      expect(result?.issues.some((i) => i.field === "provenance")).toBe(true);
      expect(result?.issues.some((i) => i.field === "width" && i.grade === "fail")).toBe(true);
    });

    it("returns null for a slot the platform has no sourced spec for", () => {
      expect(validator.auditThumbnail("toptoon", "episode", { width: 1, height: 1 })).toBeNull();
    });
  });

  describe("planAutoSlices", () => {
    it("never reports a cut that lands inside a protected element as a safe gutter cut", () => {
      // 회귀: 종전 구현은 첫 컷을 200px(보호 영역 100~400 한가운데)에 두고도
      // isGutterCut: true / safeSplitSuccessRate: 100 을 보고했다.
      const plan = validator.planAutoSlices(1000, 250, [{ top: 100, bottom: 400 }]);

      for (const slice of plan.slices.slice(0, -1)) {
        if (!slice.isGutterCut) continue;
        expect(
          [{ top: 100, bottom: 400 }].some((el) => slice.bottomY > el.top && slice.bottomY < el.bottom),
          `slice ${slice.sliceIndex} cut at ${slice.bottomY}`,
        ).toBe(false);
      }
      expect(plan.safeSplitSuccessRate).toBeLessThan(100);
    });

    it("excludes the final slice from the safe-split rate because it is not a cut", () => {
      // 절단이 전부 실패해도 마지막 구간이 분자에 섞이면 비율이 0 이 되지 않는다.
      const plan = validator.planAutoSlices(1000, 250, [
        { top: 100, bottom: 900 }, // 250/500/750 을 전부 가로지르고 대안도 없다
      ]);

      expect(plan.slices.at(-1)?.isGutterCut).toBe(true);
      expect(plan.slices.slice(0, -1).every((s) => !s.isGutterCut)).toBe(true);
      expect(plan.safeSplitSuccessRate).toBe(0);
    });

    it("does not hang when the slice height cannot advance the cut line", () => {
      // 순수 엔진이 호출자의 입력 검증에 기대면 안 된다: 0 이나 음수가 들어오면 종전 구현은
      // chosenBottom 이 전진하지 않아 while 이 영원히 돌았다.
      for (const bad of [0, -100, Number.NaN]) {
        const plan = validator.planAutoSlices(1000, bad);
        expect(plan.targetSliceHeightPx, `target ${bad}`).toBeGreaterThan(0);
        expect(plan.sliceCount, `target ${bad}`).toBeGreaterThan(0);
        expect(plan.slices.at(-1)?.bottomY, `target ${bad}`).toBe(1000);
      }
    });

    it("reports 100% when the strip is short enough that no cut is made", () => {
      const plan = validator.planAutoSlices(900, 3000, [{ top: 100, bottom: 800 }]);

      expect(plan.sliceCount).toBe(1);
      expect(plan.safeSplitSuccessRate).toBe(100);
    });

    it("plans vertical auto slices avoiding protected panels/characters", () => {
      const protectedElements = [
        { top: 2900, bottom: 3200, label: "Character Face Panel" },
        { top: 6100, bottom: 6500, label: "Action Cut" },
      ];

      const plan = validator.planAutoSlices(10_000, 3000, protectedElements);

      expect(plan.sliceCount).toBeGreaterThanOrEqual(3);
      expect(plan.slices[0].bottomY).toBeLessThanOrEqual(2900);
      expect(plan.safeSplitSuccessRate).toBeGreaterThan(70);

      // isGutterCut 은 "이 절단선이 보호 요소를 피했다" 와 정확히 같은 뜻이어야 한다.
      for (const slice of plan.slices.slice(0, -1)) {
        const crosses = protectedElements.some(
          (el) => slice.bottomY > el.top && slice.bottomY < el.bottom,
        );
        expect(slice.isGutterCut, `slice ${slice.sliceIndex} cut at ${slice.bottomY}`).toBe(!crosses);
      }
    });

    it("covers the whole strip with contiguous, non-overlapping slices", () => {
      const plan = validator.planAutoSlices(10_000, 3000, [{ top: 2900, bottom: 3200 }]);

      expect(plan.slices[0].topY).toBe(0);
      expect(plan.slices.at(-1)?.bottomY).toBe(10_000);
      for (let i = 1; i < plan.slices.length; i++) {
        expect(plan.slices[i].topY).toBe(plan.slices[i - 1].bottomY);
        expect(plan.slices[i].heightPx).toBeGreaterThan(0);
      }
    });
  });

  describe("cross-table agreement with the modules that actually export and publish", () => {
    // 같은 플랫폼을 두 표가 서로 다르게 인코딩하면, 보조 센터가 "적합"이라 한 원고를
    // 내보내기가 반려한다. 값이 어긋난다면 반드시 spec.conflicts 에 그 사실이 적혀 있어야 한다.
    //
    // 바이트 한도는 EXPORT_PRESETS 하고만 대조한다 — studio-publish-package.ts 는 MB 를
    // 10진(1_000_000)으로, 이 표와 studio-export-presets.ts 는 2진(1024*1024)으로 세기 때문에
    // 같은 "2MB" 가 서로 다른 정수가 된다. (표기 관례 불일치는 별도 보고 사항.)
    const EXPORT_PRESET_BY_PLATFORM: Partial<Record<WebtoonPlatformId, string>> = {
      "naver-webtoon": "naver-challenge",
      "webtoon-canvas": "webtoon-canvas",
      "kakao-page": "kakaopage",
      "lezhin-comics": "lezhin",
    };

    const COMPARABLE_FORMATS: readonly WebtoonImageFormat[] = ["jpg", "png", "webp"];

    it("agrees with EXPORT_PRESETS on width and format, or records the disagreement", () => {
      for (const [platformId, presetId] of Object.entries(EXPORT_PRESET_BY_PLATFORM)) {
        const spec = WEBTOON_PLATFORM_SPECS[platformId as WebtoonPlatformId];
        const preset = EXPORT_PRESETS.find((p) => p.id === presetId);
        expect(preset, `export preset ${presetId} disappeared`).toBeDefined();
        if (!preset) continue;

        expect(spec.allowedWidthsPx, `${platformId} width`).toContain(preset.width);

        // 내보내기가 다룰 수 있는 포맷(png/jpg/webp)에 한해서만 비교한다.
        const mine = COMPARABLE_FORMATS.filter((f) => spec.allowedFormats.includes(f));
        const theirs = COMPARABLE_FORMATS.filter((f) => preset.allowedFormats.includes(f as ExportFormat));
        expect(mine.slice().sort(), `${platformId} formats`).toEqual(theirs.slice().sort());
      }
    });

    it("agrees with EXPORT_PRESETS on per-image height, or records the disagreement in conflicts", () => {
      for (const [platformId, presetId] of Object.entries(EXPORT_PRESET_BY_PLATFORM)) {
        const spec = WEBTOON_PLATFORM_SPECS[platformId as WebtoonPlatformId];
        const preset = EXPORT_PRESETS.find((p) => p.id === presetId);
        if (!preset?.maxImageHeight) continue;

        if (spec.maxSliceHeightPx !== preset.maxImageHeight) {
          const declared = spec.conflicts.some(
            (c) => c.field === "height" && c.candidates.some((k) => k.value.includes(String(preset.maxImageHeight))),
          );
          expect(declared, `${platformId} height mismatch must be declared in conflicts`).toBe(true);
        }
      }
    });

    it("agrees with EXPORT_PRESETS on per-image and per-episode byte budgets", () => {
      const naver = WEBTOON_PLATFORM_SPECS["naver-webtoon"];
      const preset = EXPORT_PRESETS.find((p) => p.id === "naver-challenge");

      expect(naver.maxFileSizeBytes).toBe(preset?.maxFileBytes);
      expect(naver.episodeBudget?.maxEpisodeBytes).toBe(preset?.maxEpisodeBytes);
    });

    it("agrees with STUDIO_PUBLISH_PLATFORM_PRESETS on dimensions and formats", () => {
      const mimeToFormat: Record<string, WebtoonImageFormat> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
      };

      for (const [platformId, publishId] of [
        ["webtoon-canvas", "webtoon"],
        ["tapas", "tapas"],
      ] as const) {
        const spec = WEBTOON_PLATFORM_SPECS[platformId];
        const publish = STUDIO_PUBLISH_PLATFORM_PRESETS[publishId];

        expect(spec.allowedWidthsPx, `${platformId} width`).toContain(publish.episode.targetWidth);

        const theirs = publish.episode.allowedMimeTypes.map((m) => mimeToFormat[m]).sort();
        expect(spec.allowedFormats.slice().sort(), `${platformId} formats`).toEqual(theirs);
      }
    });

    it("matches the WEBTOON CANVAS thumbnail sizes used by the publish planner", () => {
      const publishThumbs = STUDIO_PUBLISH_PLATFORM_PRESETS.webtoon.thumbnails;
      for (const mine of WEBTOON_CANVAS_THUMBNAIL_SPECS) {
        const theirs = publishThumbs.find((t) => t.slot === mine.slot);
        expect(theirs, `publish planner lost the ${mine.slot} thumbnail`).toBeDefined();
        expect({ w: mine.widthPx, h: mine.heightPx }, mine.slot).toEqual({
          w: theirs?.width,
          h: theirs?.height,
        });
      }
    });
  });
});
