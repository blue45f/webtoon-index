import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
  STUDIO_PUBLISH_PACKAGE_POLICY_SNAPSHOT,
  STUDIO_PUBLISH_PACKAGE_SCHEMA,
  STUDIO_PUBLISH_PACKAGE_VERSION,
  STUDIO_PUBLISH_PLATFORM_PRESETS,
  getStudioPublishPlatformPreset,
  normalizeStudioPublishPackageSettings,
  planStudioPublishCanvasSlices,
  planStudioPublishPackage,
  planStudioPublishThumbnailCrop,
  sanitizeStudioPublishFileStem,
  serializeStudioPublishPackageSettings,
  type StudioPublishPackageDestination,
  type StudioPublishPackagePlanInput,
} from "./studio-publish-package";
import {
  finalizeStudioPublishPackageManifest,
  parseStudioPublishPackageManifest,
  serializeStudioPublishPackageManifest,
} from "./studio-publish-package-manifest-runtime";

const SHA256 = "a".repeat(64);

function completeSettings(destination: StudioPublishPackageDestination) {
  return {
    ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
    destination,
    outputFormat: "jpeg" as const,
    requestedThumbnailSlots: destination === "generic" ? [] : (["episode"] as const),
    includeCredits: false,
    policyReviewConfirmed: true,
    thumbnailSafetyConfirmed: true,
  };
}

function validInput(destination: StudioPublishPackageDestination): StudioPublishPackagePlanInput {
  const width = destination === "webtoon" ? 800 : destination === "tapas" ? 940 : 1_200;
  const height = destination === "webtoon" ? 1_280 : 2_400;
  const thumbnail =
    destination === "webtoon"
      ? { width: 202, height: 142, byteSize: 120_000 }
      : { width: 300, height: 300, byteSize: 800_000 };
  return {
    settings: completeSettings(destination),
    seriesTitle: "별빛 탐정단",
    episodeTitle: "첫 번째 단서",
    episodeNumber: 7,
    canvases: [{ id: "canvas-private-1", width, height: 3_000 }],
    episodeImages: [
      {
        id: "render-private-1",
        sourceCanvasId: "canvas-private-1",
        mimeType: "image/jpeg",
        width,
        height,
        byteSize: 1_000_000,
        sha256: SHA256,
        fileName: "../../do-not-trust.jpg",
        localPath: "/Users/creator/secret/source.psd",
      },
    ],
    thumbnails:
      destination === "generic"
        ? []
        : [
            {
              id: "thumbnail-private-1",
              slot: "episode",
              mimeType: "image/jpeg",
              ...thumbnail,
            },
          ],
  };
}

describe("studio publish platform presets", () => {
  it("provides deterministic, dated destination presets", () => {
    expect(Object.keys(STUDIO_PUBLISH_PLATFORM_PRESETS)).toEqual(["generic", "webtoon", "tapas"]);
    expect(getStudioPublishPlatformPreset("webtoon")).toEqual(
      getStudioPublishPlatformPreset("webtoon")
    );
    expect(getStudioPublishPlatformPreset("webtoon").policySnapshotDate).toBe(
      STUDIO_PUBLISH_PACKAGE_POLICY_SNAPSHOT
    );
    expect(getStudioPublishPlatformPreset("webtoon").requiresCurrentPolicyReview).toBe(true);
    expect(getStudioPublishPlatformPreset("generic").requiresCurrentPolicyReview).toBe(false);
    expect(Object.isFrozen(STUDIO_PUBLISH_PLATFORM_PRESETS)).toBe(true);
    expect(Object.isFrozen(getStudioPublishPlatformPreset("webtoon").episode)).toBe(true);
    expect(Object.isFrozen(getStudioPublishPlatformPreset("webtoon").thumbnails)).toBe(true);
  });

  it("captures the benchmarked WEBTOON and Tapas image constraints", () => {
    const webtoon = getStudioPublishPlatformPreset("webtoon");
    expect(webtoon.episode).toMatchObject({ targetWidth: 800, maxHeight: 1_280 });
    expect(webtoon.thumbnails.find((item) => item.slot === "episode")).toMatchObject({
      required: true,
      width: 202,
      height: 142,
      maxBytesExclusive: 500_000,
      asciiAlphanumericFileStem: true,
    });

    const tapas = getStudioPublishPlatformPreset("tapas");
    expect(tapas.episode).toMatchObject({
      targetWidth: 940,
      maxBytesExclusive: 2_000_000,
      maxEpisodeBytesExclusive: 20_000_000,
    });
    expect(tapas.episode.maxHeightByMimeType).toEqual({ "image/gif": 1_000 });
    expect(tapas.aiPolicy).toBe("generated-prohibited");
  });
});

describe("publish package settings and file names", () => {
  it("migrates legacy aliases, bounds text, sorts slots, and drops unknown secrets", () => {
    const settings = normalizeStudioPublishPackageSettings({
      platform: "webtoon-canvas",
      format: "jpg",
      thumbnailSlots: ["series-vertical", "episode", "episode", "invalid"],
      includePdf: true,
      pdfProfile: "full",
      includeCredits: false,
      aiContent: "assisted",
      disclosure: `  ${"설명".repeat(1_000)}  `,
      policyReviewed: true,
      thumbnailReviewed: true,
      apiKey: "must-not-survive",
      rawPrompt: "private",
    });

    expect(settings).toEqual({
      version: 1,
      destination: "webtoon",
      outputFormat: "jpeg",
      requestedThumbnailSlots: ["episode", "series-vertical"],
      includeReviewPdf: true,
      reviewPdfProfile: "production-full",
      includeCredits: false,
      aiUsage: "assisted",
      aiDisclosure: expect.any(String),
      policyReviewConfirmed: true,
      thumbnailSafetyConfirmed: true,
    });
    expect(settings.aiDisclosure.length).toBe(1_000);
    expect(serializeStudioPublishPackageSettings(settings)).not.toContain("apiKey");
    expect(serializeStudioPublishPackageSettings(settings)).not.toContain("rawPrompt");
  });

  it("defaults unknown review PDF profiles to image-only and never exposes the profile in the public manifest", () => {
    expect(normalizeStudioPublishPackageSettings({ reviewPdfProfile: "unknown" }).reviewPdfProfile).toBe("image-only");
    const input = validInput("generic");
    input.settings = {
      ...completeSettings("generic"),
      includeReviewPdf: true,
      reviewPdfProfile: "approval",
    };
    const manifest = planStudioPublishPackage(input).manifest;
    expect(JSON.stringify(manifest)).not.toContain("approval");
    expect(JSON.stringify(manifest)).not.toContain("reviewPdfProfile");
  });

  it("returns a cloned safe default for non-record settings", () => {
    const first = normalizeStudioPublishPackageSettings(null);
    first.requestedThumbnailSlots.push("series-cover");
    const second = normalizeStudioPublishPackageSettings(null);
    expect(second.requestedThumbnailSlots).toEqual(["episode"]);
    expect(DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS.requestedThumbnailSlots).toEqual(["episode"]);
  });

  it("rejects future settings and malformed JSON", () => {
    expect(() => normalizeStudioPublishPackageSettings({ version: 2 })).toThrow("최신 버전");
    expect(() => normalizeStudioPublishPackageSettings({ version: "2" })).toThrow("최신 버전");
    expect(() => normalizeStudioPublishPackageSettings("{broken")).toThrow("JSON");
  });

  it("sanitizes traversal, controls, bidi marks, punctuation, and reserved device names", () => {
    expect(sanitizeStudioPublishFileStem(" ../비밀/회차:*?\u202e.exe ")).toBe("비밀-회차-exe");
    expect(sanitizeStudioPublishFileStem("CON")).toBe("toonspectrum");
    expect(sanitizeStudioPublishFileStem("  A---B...  ")).toBe("A-B");
    expect(sanitizeStudioPublishFileStem("café와 별", { asciiOnly: true })).toBe("cafe");
    expect(
      sanitizeStudioPublishFileStem("회차-001 thumb", {
        alphanumericOnly: true,
        fallback: "episode001thumbnail",
      })
    ).toBe("001thumb");
  });

  it("honors a bounded output stem length", () => {
    expect(sanitizeStudioPublishFileStem("a".repeat(500), { maxCodeUnits: 24 })).toHaveLength(24);
  });
});

describe("publish package validation and artifact planning", () => {
  it("plans resampled WEBTOON slices with continuous source geometry", () => {
    const slices = planStudioPublishCanvasSlices({
      destination: "webtoon",
      seriesTitle: "별빛 탐정단",
      episodeNumber: 7,
      format: "png",
      canvases: [
        { id: "page-1", width: 1_600, height: 5_120 },
        { id: "invalid" },
      ],
    });

    expect(slices).toHaveLength(2);
    expect(slices[0]).toEqual({
      sourceCanvasId: "page-1",
      sourceCanvasIndex: 0,
      sliceIndex: 0,
      sliceCount: 2,
      source: { x: 0, y: 0, width: 1_600, height: 2_560 },
      output: { width: 800, height: 1_280 },
      mimeType: "image/png",
      fileName: "episode-007-webtoon-001.png",
    });
    expect(slices[1]).toMatchObject({
      source: { y: 2_560, height: 2_560 },
      output: { width: 800, height: 1_280 },
      fileName: "episode-007-webtoon-002.png",
    });
  });

  it("uses browser-safe slices when a destination has no static-height limit", () => {
    const slices = planStudioPublishCanvasSlices({
      destination: "tapas",
      seriesTitle: "Series",
      episodeNumber: 1,
      format: "jpeg",
      canvases: [{ id: "page", width: 940, height: 20_000 }],
    });
    expect(slices.map((slice) => slice.output.height)).toEqual([16_384, 3_616]);
    expect(slices.every((slice) => slice.output.width === 940)).toBe(true);
  });

  it("applies the GIF-specific height limit during Tapas slice planning", () => {
    const slices = planStudioPublishCanvasSlices({
      destination: "tapas",
      seriesTitle: "Series",
      format: "gif",
      canvases: [{ id: "page", width: 940, height: 2_001 }],
    });
    expect(slices.map((slice) => slice.output.height)).toEqual([1_000, 1_000, 1]);
  });

  it("plans deterministic thumbnail cover crops around a clamped focal point", () => {
    const centered = planStudioPublishThumbnailCrop({
      destination: "webtoon",
      slot: "episode",
      sourceWidth: 1_000,
      sourceHeight: 1_000,
    });
    expect(centered).toEqual({
      slot: "episode",
      strategy: "cover",
      source: { x: 0, y: 148.514851, width: 1_000, height: 702.970297 },
      output: { width: 202, height: 142 },
      scale: 0.202,
    });

    const bottom = planStudioPublishThumbnailCrop({
      destination: "webtoon",
      slot: "episode",
      sourceWidth: 1_000,
      sourceHeight: 1_000,
      focalY: 4,
    });
    expect(bottom?.source.y).toBe(297.029703);
    expect(
      planStudioPublishThumbnailCrop({
        destination: "generic",
        slot: "series-cover",
        sourceWidth: 100,
        sourceHeight: 100,
      })
    ).toBeNull();
  });

  it.each(["generic", "webtoon", "tapas"] as const)(
    "plans a valid %s package deterministically",
    (destination) => {
      const input = validInput(destination);
      const first = planStudioPublishPackage(input);
      const second = planStudioPublishPackage(input);

      expect(first).toEqual(second);
      expect(first.canExport).toBe(true);
      expect(first.errors).toEqual([]);
      expect(first.manifest.schema).toBe(STUDIO_PUBLISH_PACKAGE_SCHEMA);
      expect(first.manifest.version).toBe(STUDIO_PUBLISH_PACKAGE_VERSION);
      expect(first.manifest.destination).toBe(destination);
      expect(first.manifest.totals.episodeImageCount).toBe(1);
      expect(first.manifest.artifacts.at(-1)).toMatchObject({
        role: "manifest",
        fileName: "manifest.json",
      });
    }
  );

  it("uses generated names and excludes internal source names, IDs, and paths from the manifest", () => {
    const plan = planStudioPublishPackage(validInput("webtoon"));
    const serialized = JSON.stringify(plan.manifest);

    expect(plan.artifacts[0]).toMatchObject({
      sourceId: "render-private-1",
      fileName: "episode-007-webtoon-001.jpeg",
    });
    expect(serialized).not.toContain("render-private-1");
    expect(serialized).not.toContain("canvas-private-1");
    expect(serialized).not.toContain("do-not-trust");
    expect(serialized).not.toContain("/Users/creator");
  });

  it("reports required titles and a bounded positive episode number", () => {
    const plan = planStudioPublishPackage({
      ...validInput("generic"),
      seriesTitle: " ",
      episodeTitle: "",
      episodeNumber: 0,
    });
    expect(plan.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "SERIES_TITLE_REQUIRED",
        "EPISODE_TITLE_REQUIRED",
        "EPISODE_NUMBER_INVALID",
      ])
    );
  });

  it("distinguishes missing final metadata from invalid metadata", () => {
    const missing = planStudioPublishPackage({
      ...validInput("tapas"),
      episodeImages: [{ id: "image-1", sourceCanvasId: "canvas-private-1" }],
    });
    expect(missing.warnings.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "IMAGE_MIME_MISSING",
        "IMAGE_DIMENSIONS_MISSING",
        "IMAGE_BYTE_SIZE_MISSING",
        "EPISODE_TOTAL_SIZE_UNVERIFIED",
      ])
    );
    expect(missing.artifacts[0].state).toBe("metadata-incomplete");

    const invalid = planStudioPublishPackage({
      ...validInput("webtoon"),
      episodeImages: [
        {
          id: "image-1",
          mimeType: "image/webp",
          width: -1,
          height: Number.NaN,
          byteSize: 0,
        },
      ],
    });
    expect(invalid.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "IMAGE_MIME_UNSUPPORTED",
        "IMAGE_DIMENSIONS_INVALID",
        "IMAGE_BYTE_SIZE_INVALID",
      ])
    );
  });

  it("validates canvas IDs, dimensions, resampling, orientation, and pixel area", () => {
    const plan = planStudioPublishPackage({
      ...validInput("webtoon"),
      canvases: [
        { id: "same", width: 1_600, height: 800 },
        { id: "same", width: 20_000, height: 20_000 },
        { id: "", width: 0, height: 100 },
        { id: "missing-size" },
      ],
    });
    const codes = plan.issues.map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "CANVAS_ID_DUPLICATE",
        "CANVAS_ID_REQUIRED",
        "CANVAS_DIMENSIONS_INVALID",
        "CANVAS_DIMENSIONS_MISSING",
        "CANVAS_RESAMPLE_REQUIRED",
        "CANVAS_VERTICAL_RECOMMENDED",
        "CANVAS_PIXEL_AREA_LARGE",
      ])
    );
  });

  it("warns when source canvas metadata is absent instead of inventing geometry", () => {
    const input = validInput("generic");
    delete input.canvases;
    const plan = planStudioPublishPackage(input);
    expect(plan.warnings.map((issue) => issue.code)).toContain("CANVAS_METADATA_MISSING");
    expect(plan.canExport).toBe(true);
  });

  it("checks duplicate image IDs and unknown source links", () => {
    const first = validInput("generic").episodeImages[0];
    const plan = planStudioPublishPackage({
      ...validInput("generic"),
      episodeImages: [
        { ...first, id: "duplicate", sourceCanvasId: "missing" },
        { ...first, id: "duplicate", sourceCanvasId: "missing" },
      ],
    });
    expect(plan.errors.map((issue) => issue.code)).toContain("IMAGE_ID_DUPLICATE");
    expect(plan.warnings.map((issue) => issue.code)).toContain("IMAGE_SOURCE_UNKNOWN");
  });

  it("enforces final WEBTOON width and slice height", () => {
    const plan = planStudioPublishPackage({
      ...validInput("webtoon"),
      episodeImages: [
        {
          id: "wrong-size",
          mimeType: "image/png",
          width: 801,
          height: 1_281,
          byteSize: 100_000,
        },
      ],
    });
    expect(plan.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["IMAGE_WIDTH_MISMATCH", "IMAGE_HEIGHT_EXCEEDED"])
    );
  });

  it("enforces Tapas's exclusive per-file and total size bounds", () => {
    const images = Array.from({ length: 10 }, (_, index) => ({
      id: `image-${index}`,
      mimeType: "image/jpeg",
      width: 940,
      height: 2_000,
      byteSize: 2_000_000,
    }));
    const plan = planStudioPublishPackage({ ...validInput("tapas"), episodeImages: images });
    expect(plan.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["IMAGE_FILE_TOO_LARGE", "EPISODE_TOTAL_SIZE_EXCEEDED"])
    );
    expect(plan.manifest.totals.knownEpisodeBytes).toBe(20_000_000);
  });

  it("applies Tapas's height cap only to GIF episode files", () => {
    const gif = planStudioPublishPackage({
      ...validInput("tapas"),
      episodeImages: [
        { id: "gif", mimeType: "image/gif", width: 940, height: 1_001, byteSize: 100_000 },
      ],
    });
    expect(gif.errors.map((issue) => issue.code)).toContain("IMAGE_HEIGHT_EXCEEDED");

    const png = planStudioPublishPackage({
      ...validInput("tapas"),
      episodeImages: [
        { id: "png", mimeType: "image/png", width: 940, height: 20_000, byteSize: 100_000 },
      ],
    });
    expect(png.errors.map((issue) => issue.code)).not.toContain("IMAGE_HEIGHT_EXCEEDED");
  });

  it("plans a required thumbnail placeholder and blocks export when its source is missing", () => {
    const plan = planStudioPublishPackage({ ...validInput("webtoon"), thumbnails: [] });
    expect(plan.errors.map((issue) => issue.code)).toContain("THUMBNAIL_REQUIRED");
    expect(plan.canExport).toBe(false);
    expect(plan.artifacts.find((artifact) => artifact.slot === "episode")).toMatchObject({
      state: "needs-source",
      width: 202,
      height: 142,
      fileName: "episode007thumbnail.jpeg",
    });
    expect(
      plan.artifacts.find((artifact) => artifact.slot === "episode")?.fileName.split(".")[0]
    ).toMatch(/^[A-Za-z0-9]+$/u);
  });

  it("validates thumbnail format, exact geometry, exclusive bytes, and duplicate slots", () => {
    const thumbnail = {
      id: "thumb-1",
      slot: "episode" as const,
      mimeType: "image/webp",
      width: 300,
      height: 300,
      byteSize: 500_000,
    };
    const plan = planStudioPublishPackage({
      ...validInput("webtoon"),
      thumbnails: [thumbnail, { ...thumbnail, id: "thumb-2" }],
    });
    expect(plan.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "THUMBNAIL_SLOT_DUPLICATE",
        "THUMBNAIL_MIME_UNSUPPORTED",
        "THUMBNAIL_DIMENSIONS_MISMATCH",
        "THUMBNAIL_FILE_TOO_LARGE",
      ])
    );
  });

  it("plans optional requested destination thumbnails without falsely requiring their source", () => {
    const input = validInput("webtoon");
    input.settings = {
      ...completeSettings("webtoon"),
      requestedThumbnailSlots: ["episode", "series-square", "series-vertical"],
    };
    const plan = planStudioPublishPackage(input);
    expect(plan.errors.map((issue) => issue.code)).not.toContain("THUMBNAIL_REQUIRED");
    expect(plan.artifacts.filter((artifact) => artifact.role === "thumbnail")).toHaveLength(3);
    expect(plan.artifacts.find((artifact) => artifact.slot === "series-vertical")).toMatchObject({
      state: "needs-source",
      width: 1_080,
      height: 1_920,
    });
  });

  it("blocks a destination package until the manual thumbnail safety review is confirmed", () => {
    const input = validInput("webtoon");
    input.settings = { ...completeSettings("webtoon"), thumbnailSafetyConfirmed: false };
    const plan = planStudioPublishPackage(input);
    expect(plan.errors.map((issue) => issue.code)).toContain("THUMBNAIL_CONTENT_REVIEW_REQUIRED");
    expect(plan.canExport).toBe(false);
  });

  it("requires AI disclosure and blocks generated content for the Tapas preset", () => {
    const input = validInput("tapas");
    input.settings = { ...completeSettings("tapas"), aiUsage: "generated", aiDisclosure: "" };
    const plan = planStudioPublishPackage(input);
    expect(plan.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "AI_DISCLOSURE_REQUIRED",
        "TAPAS_AI_GENERATED_CONTENT_PROHIBITED",
      ])
    );
    expect(plan.artifacts.map((artifact) => artifact.role)).toContain("ai-disclosure");
  });

  it("allows disclosed AI assistance while exposing only the deliberate public statement", () => {
    const input = validInput("webtoon");
    input.settings = {
      ...completeSettings("webtoon"),
      aiUsage: "assisted",
      aiDisclosure: "대사 초안 정리에 AI 보조를 사용했고 작가가 최종 검수했습니다.",
      rawPrompt: "this key is ignored",
    };
    const plan = planStudioPublishPackage(input);
    expect(plan.canExport).toBe(true);
    expect(plan.manifest.ai).toEqual({
      usage: "assisted",
      disclosure: "대사 초안 정리에 AI 보조를 사용했고 작가가 최종 검수했습니다.",
    });
    expect(JSON.stringify(plan.manifest)).not.toContain("rawPrompt");
  });

  it("blocks a destination package until the current policy review is confirmed", () => {
    const input = validInput("webtoon");
    input.settings = { ...completeSettings("webtoon"), policyReviewConfirmed: false };
    const plan = planStudioPublishPackage(input);
    expect(plan.errors.map((issue) => issue.code)).toContain("POLICY_REVIEW_REQUIRED");
    expect(plan.canExport).toBe(false);
  });

  it("plans review, credits, disclosure, report, and manifest support artifacts in stable order", () => {
    const input = validInput("generic");
    input.settings = {
      ...completeSettings("generic"),
      includeReviewPdf: true,
      includeCredits: true,
      aiUsage: "assisted",
      aiDisclosure: "색상 아이디어에 AI 보조를 사용했습니다.",
    };
    input.creditsText = "배경 자료: 직접 촬영";
    const roles = planStudioPublishPackage(input).artifacts.map((artifact) => artifact.role);
    expect(roles).toEqual([
      "episode-image",
      "review-pdf",
      "credits",
      "ai-disclosure",
      "validation-report",
      "manifest",
    ]);
  });

  it("does not read the clock and canonicalizes only an explicitly supplied timestamp", () => {
    const withoutTimestamp = planStudioPublishPackage(validInput("generic"));
    expect(withoutTimestamp.manifest).not.toHaveProperty("generatedAt");

    const withTimestamp = planStudioPublishPackage({
      ...validInput("generic"),
      generatedAt: "2026-07-10T12:34:56+09:00",
    });
    expect(withTimestamp.manifest.generatedAt).toBe("2026-07-10T03:34:56.000Z");

    const invalidTimestamp = planStudioPublishPackage({
      ...validInput("generic"),
      generatedAt: new Date(Number.NaN),
    });
    expect(invalidTimestamp.manifest).not.toHaveProperty("generatedAt");
  });

  it("drops invalid checksums but carries valid SHA-256 integrity metadata", () => {
    const valid = validInput("generic");
    valid.episodeImages = [
      { ...valid.episodeImages[0], id: "bad", sha256: "not-a-sha" },
      { ...valid.episodeImages[0], id: "good", sha256: "B".repeat(64) },
    ];
    const plan = planStudioPublishPackage(valid);
    expect(plan.warnings.map((issue) => issue.code)).toContain("CHECKSUM_INVALID");
    expect(plan.manifest.artifacts[0]).not.toHaveProperty("sha256");
    expect(plan.manifest.artifacts[1].sha256).toBe("b".repeat(64));
  });
});

describe("privacy-safe manifest migration and serialization", () => {
  it("round-trips a planned manifest through the public schema", () => {
    const manifest = planStudioPublishPackage(validInput("webtoon")).manifest;
    const parsed = parseStudioPublishPackageManifest(serializeStudioPublishPackageManifest(manifest));
    expect(parsed).toEqual(manifest);
  });

  it("migrates a legacy manifest, sanitizes names, deduplicates collisions, and recomputes totals", () => {
    const parsed = parseStudioPublishPackageManifest({
      platform: "tapas",
      title: "Legacy Series",
      episodeName: "Legacy Episode",
      episode: 3,
      createdAt: "2026-07-10T00:00:00Z",
      files: [
        {
          type: "episode-image",
          name: "../../page:01.jpg",
          mime: "image/jpeg",
          width: 940,
          height: 2_000,
          bytes: 100,
          sourceId: "private",
          localPath: "/secret",
        },
        { type: "episode-image", name: "..\\..\\PAGE:01.JPG", bytes: 200 },
        { type: "unknown", name: "ignored.bin" },
      ],
      aiUsage: "assisted",
      aiDisclosure: "AI 보조 후 직접 검수",
      rawPrompt: "must-not-survive",
      apiKey: "must-not-survive",
      validation: { canExport: true, errorCount: 0, warningCount: 2 },
    });

    expect(parsed).toMatchObject({
      schema: STUDIO_PUBLISH_PACKAGE_SCHEMA,
      version: 1,
      destination: "tapas",
      publication: { seriesTitle: "Legacy Series", episodeTitle: "Legacy Episode", episodeNumber: 3 },
      generatedAt: "2026-07-10T00:00:00.000Z",
      totals: { episodeImageCount: 1, thumbnailCount: 0, knownEpisodeBytes: 100 },
      ai: { usage: "assisted", disclosure: "AI 보조 후 직접 검수" },
      validation: { canExport: true, errorCount: 0, warningCount: 2 },
    });
    expect(parsed.artifacts[0].fileName).toBe("page-01.jpg");
    const serialized = serializeStudioPublishPackageManifest(parsed);
    expect(serialized).not.toContain("sourceId");
    expect(serialized).not.toContain("localPath");
    expect(serialized).not.toContain("rawPrompt");
    expect(serialized).not.toContain("apiKey");
  });

  it("rejects malformed, future, and excessively large manifests", () => {
    expect(() => parseStudioPublishPackageManifest("{bad")).toThrow("JSON");
    expect(() => parseStudioPublishPackageManifest(null)).toThrow("올바르지 않은");
    expect(() => parseStudioPublishPackageManifest({ version: 2 })).toThrow("최신 버전");
    expect(() =>
      parseStudioPublishPackageManifest({
        files: Array.from({ length: 1_101 }, (_, index) => ({
          type: "episode-image",
          name: `page-${index}.png`,
        })),
      })
    ).toThrow("안전 한도");
  });

  it("never trusts imported totals, credits flags, or canExport with reported errors", () => {
    const parsed = parseStudioPublishPackageManifest({
      destination: "generic",
      title: "Series",
      episodeTitle: "Episode",
      artifacts: [{ role: "manifest", fileName: "manifest.json" }],
      totals: { episodeImageCount: 999, thumbnailCount: 999, knownEpisodeBytes: 999 },
      creditsIncluded: true,
      validation: { canExport: true, errorCount: 4, warningCount: 0 },
    });
    expect(parsed.totals).toEqual({ episodeImageCount: 0, thumbnailCount: 0, knownEpisodeBytes: 0 });
    expect(parsed.creditsIncluded).toBe(false);
    expect(parsed.validation).toEqual({ canExport: false, errorCount: 4, warningCount: 0 });
  });

  it("finalizes every non-self-referential artifact with actual bytes and hashes", () => {
    const planned = planStudioPublishPackage(validInput("webtoon")).manifest;
    const actual = planned.artifacts
      .filter(({ role }) => role !== "manifest")
      .map((artifact, index) => ({
        fileName: artifact.fileName,
        mimeType: artifact.mimeType ?? "application/octet-stream",
        byteSize: 1_000 + index,
        sha256: String(index + 1).padStart(64, "a").slice(-64),
      }));
    const finalized = finalizeStudioPublishPackageManifest(planned, actual);

    expect(finalized.artifacts.filter(({ role }) => role !== "manifest").every(
      ({ state, byteSize, sha256 }) => state === "ready" && Boolean(byteSize) && Boolean(sha256)
    )).toBe(true);
    expect(finalized.artifacts.find(({ role }) => role === "manifest")?.state).toBe("planned");
    expect(finalized.totals.knownEpisodeBytes).toBe(1_000);
  });

  it("rejects missing, extra, duplicate, and MIME-mismatched rendered package files", () => {
    const planned = planStudioPublishPackage(validInput("webtoon")).manifest;
    const actual = planned.artifacts
      .filter(({ role }) => role !== "manifest")
      .map((artifact) => ({
        fileName: artifact.fileName,
        mimeType: artifact.mimeType ?? "application/octet-stream",
        byteSize: 100,
        sha256: "f".repeat(64),
      }));

    expect(() => finalizeStudioPublishPackageManifest(planned, actual.slice(1))).toThrow("생성되지 않았습니다");
    expect(() => finalizeStudioPublishPackageManifest(planned, [
      ...actual,
      { fileName: "unexpected.json", mimeType: "application/json", byteSize: 1, sha256: "e".repeat(64) },
    ])).toThrow("manifest에 없는");
    expect(() => finalizeStudioPublishPackageManifest(planned, [...actual, actual[0]])).toThrow("중복");
    expect(() => finalizeStudioPublishPackageManifest(planned, [
      { ...actual[0], mimeType: "application/json" },
      ...actual.slice(1),
    ])).toThrow("형식이 manifest와 다릅니다");
  });
});
