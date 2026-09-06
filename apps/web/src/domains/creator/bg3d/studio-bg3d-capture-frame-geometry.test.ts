import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_CAPTURE_ASPECT_MAX,
  STUDIO_BG3D_CAPTURE_ASPECT_MIN,
  STUDIO_BG3D_CAPTURE_ASPECT_PRESETS,
  STUDIO_BG3D_CAPTURE_VIEW_OFFSET_UNIT,
  createStudioBg3dDocumentCaptureAspectPreset,
  matchStudioBg3dCaptureAspectPreset,
  normalizeStudioBg3dCaptureAspectRatio,
  resolveStudioBg3dCaptureFrame,
  resolveStudioBg3dCaptureFrameCameraSettings,
  resolveStudioBg3dCaptureViewOffset,
} from "./studio-bg3d-capture-frame-geometry";
import { resolveStudioBg3dLtCaptureSize } from "./studio-bg3d-lt-capture-size";
import { deriveStudioBg3dVanishingPoints } from "./studio-bg3d-perspective-bridge";

import type { StudioBg3dCameraSettings } from "./studio-bg3d-scene-document";

const CAMERA: StudioBg3dCameraSettings = {
  position: [6, 4, 9],
  target: [0, 1, 0],
  fovDegrees: 50,
  projection: "perspective",
  zoom: 1,
};

/** 실제 투영이 보는 반화각 탄젠트. 세로는 fov/zoom, 가로는 거기에 비율을 곱한 값이다. */
function halfTangents(camera: StudioBg3dCameraSettings, aspect: number) {
  const vertical = Math.tan((camera.fovDegrees * Math.PI) / 360) / (camera.zoom ?? 1);
  return { horizontal: vertical * aspect, vertical };
}

describe("resolveStudioBg3dCaptureFrame", () => {
  it("follows the viewport exactly when the document has no explicit aspect", () => {
    for (const aspectRatio of [undefined, null]) {
      expect(
        resolveStudioBg3dCaptureFrame({
          viewportWidth: 1_512,
          viewportHeight: 851,
          aspectRatio,
        }),
      ).toEqual({
        x: 0,
        y: 0,
        width: 1_512,
        height: 851,
        aspectRatio: 1_512 / 851,
        fit: "exact",
        followsViewport: true,
        scaleX: 1,
        scaleY: 1,
      });
    }
  });

  it("pillarboxes a capture narrower than the viewport and keeps full height", () => {
    const frame = resolveStudioBg3dCaptureFrame({
      viewportWidth: 1_600,
      viewportHeight: 900,
      aspectRatio: 1,
    });
    expect(frame).toEqual({
      x: 350,
      y: 0,
      width: 900,
      height: 900,
      aspectRatio: 1,
      fit: "pillarbox",
      followsViewport: false,
      scaleX: 1_600 / 900,
      scaleY: 1,
    });
  });

  it("letterboxes a capture wider than the viewport and keeps full width", () => {
    const frame = resolveStudioBg3dCaptureFrame({
      viewportWidth: 900,
      viewportHeight: 1_600,
      aspectRatio: 1,
    });
    expect(frame).toEqual({
      x: 0,
      y: 350,
      width: 900,
      height: 900,
      aspectRatio: 1,
      fit: "letterbox",
      followsViewport: false,
      scaleX: 1,
      scaleY: 1_600 / 900,
    });
  });

  it("never leaves the viewport and always stays centred", () => {
    for (const [viewportWidth, viewportHeight] of [[1_280, 720], [640, 1_136], [1_000, 1_000]] as const) {
      for (const aspectRatio of [0.25, 0.5625, 0.75, 1, 4 / 3, 16 / 9, 4]) {
        const frame = resolveStudioBg3dCaptureFrame({ viewportWidth, viewportHeight, aspectRatio });
        expect(frame).not.toBeNull();
        expect(frame!.width).toBeLessThanOrEqual(viewportWidth + 1e-9);
        expect(frame!.height).toBeLessThanOrEqual(viewportHeight + 1e-9);
        expect(frame!.x).toBeCloseTo((viewportWidth - frame!.width) / 2, 9);
        expect(frame!.y).toBeCloseTo((viewportHeight - frame!.height) / 2, 9);
        expect(frame!.width / frame!.height).toBeCloseTo(aspectRatio, 9);
        expect(frame!.scaleX).toBeGreaterThanOrEqual(1 - 1e-9);
        expect(frame!.scaleY).toBeGreaterThanOrEqual(1 - 1e-9);
        // contain-fit이므로 한 축은 반드시 뷰포트를 꽉 채운다.
        expect(Math.min(frame!.scaleX, frame!.scaleY)).toBeCloseTo(1, 9);
      }
    }
  });

  it("treats an explicit ratio equal to the viewport as an uncropped frame", () => {
    const frame = resolveStudioBg3dCaptureFrame({
      viewportWidth: 1_920,
      viewportHeight: 1_080,
      aspectRatio: 1_920 / 1_080,
    });
    expect(frame).toMatchObject({ fit: "exact", followsViewport: false, scaleX: 1, scaleY: 1 });
  });

  it("clamps an out-of-contract ratio and fails hostile input closed", () => {
    expect(resolveStudioBg3dCaptureFrame({ viewportWidth: 1_000, viewportHeight: 1_000, aspectRatio: 99 }))
      .toMatchObject({ aspectRatio: STUDIO_BG3D_CAPTURE_ASPECT_MAX });
    expect(resolveStudioBg3dCaptureFrame({ viewportWidth: 1_000, viewportHeight: 1_000, aspectRatio: 0.01 }))
      .toMatchObject({ aspectRatio: STUDIO_BG3D_CAPTURE_ASPECT_MIN });
    for (const input of [
      { viewportWidth: 0, viewportHeight: 100 },
      { viewportWidth: 100, viewportHeight: Number.NaN },
      { viewportWidth: Number.POSITIVE_INFINITY, viewportHeight: 100 },
      { viewportWidth: 100, viewportHeight: 100, aspectRatio: Number.NaN },
      { viewportWidth: 100, viewportHeight: 100, aspectRatio: 0 },
      { viewportWidth: 100, viewportHeight: 100, aspectRatio: -2 },
    ]) {
      expect(resolveStudioBg3dCaptureFrame(input)).toBeNull();
    }
  });

  it("is frozen", () => {
    const frame = resolveStudioBg3dCaptureFrame({
      viewportWidth: 1_600,
      viewportHeight: 900,
      aspectRatio: 1,
    });
    expect(Object.isFrozen(frame)).toBe(true);
  });
});

describe("capture frame FOV preservation", () => {
  it("keeps the vertical FOV when pillarboxing and the horizontal FOV when letterboxing", () => {
    const viewport = { width: 1_600, height: 900 };
    const viewportAspect = viewport.width / viewport.height;
    const base = halfTangents(CAMERA, viewportAspect);

    const pillarbox = resolveStudioBg3dCaptureFrame({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      aspectRatio: 1,
    })!;
    const pillarCamera = resolveStudioBg3dCaptureFrameCameraSettings(CAMERA, pillarbox);
    const pillar = halfTangents(pillarCamera, pillarbox.aspectRatio);
    expect(pillarbox.fit).toBe("pillarbox");
    expect(pillar.vertical).toBeCloseTo(base.vertical, 12);
    expect(pillar.horizontal).toBeLessThan(base.horizontal);
    expect(pillar.horizontal).toBeCloseTo(base.horizontal / pillarbox.scaleX, 12);

    const letterbox = resolveStudioBg3dCaptureFrame({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      aspectRatio: STUDIO_BG3D_CAPTURE_ASPECT_MAX,
    })!;
    const letterCamera = resolveStudioBg3dCaptureFrameCameraSettings(CAMERA, letterbox);
    const letter = halfTangents(letterCamera, letterbox.aspectRatio);
    expect(letterbox.fit).toBe("letterbox");
    expect(letter.horizontal).toBeCloseTo(base.horizontal, 12);
    expect(letter.vertical).toBeLessThan(base.vertical);
    expect(letter.vertical).toBeCloseTo(base.vertical / letterbox.scaleY, 12);
  });

  it("returns the same camera object for an uncropped frame", () => {
    const frame = resolveStudioBg3dCaptureFrame({ viewportWidth: 800, viewportHeight: 600 })!;
    expect(resolveStudioBg3dCaptureFrameCameraSettings(CAMERA, frame)).toBe(CAMERA);
  });

  it("reprojects vanishing points exactly onto the cropped raster", () => {
    const viewport = { width: 1_600, height: 900 };
    for (const aspectRatio of [1, 0.5625, 4 / 3, 4]) {
      const frame = resolveStudioBg3dCaptureFrame({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        aspectRatio,
      })!;
      const full = deriveStudioBg3dVanishingPoints(CAMERA, viewport.width, viewport.height);
      const cropped = deriveStudioBg3dVanishingPoints(
        resolveStudioBg3dCaptureFrameCameraSettings(CAMERA, frame),
        frame.width,
        frame.height,
      );
      expect(cropped).toHaveLength(full.length);
      expect(full.length).toBeGreaterThan(0);
      for (let index = 0; index < full.length; index += 1) {
        // 중앙 크롭은 뷰포트 픽셀 좌표에서 프레임 원점을 뺀 것과 같아야 한다.
        expect(cropped[index]!.x).toBeCloseTo(full[index]!.x - frame.x, 6);
        expect(cropped[index]!.y).toBeCloseTo(full[index]!.y - frame.y, 6);
      }
    }
  });

  it("scales a persisted lens shift with the crop so the shifted view stays put", () => {
    const shifted: StudioBg3dCameraSettings = { ...CAMERA, lensShift: [0.1, -0.05] };
    const viewport = { width: 1_600, height: 900 };
    const frame = resolveStudioBg3dCaptureFrame({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      aspectRatio: 1,
    })!;
    const full = deriveStudioBg3dVanishingPoints(shifted, viewport.width, viewport.height);
    const cropped = deriveStudioBg3dVanishingPoints(
      resolveStudioBg3dCaptureFrameCameraSettings(shifted, frame),
      frame.width,
      frame.height,
    );
    expect(full.length).toBeGreaterThan(0);
    for (let index = 0; index < full.length; index += 1) {
      expect(cropped[index]!.x).toBeCloseTo(full[index]!.x - frame.x, 6);
      expect(cropped[index]!.y).toBeCloseTo(full[index]!.y - frame.y, 6);
    }
  });
});

describe("resolveStudioBg3dCaptureViewOffset", () => {
  it("maps the safe-frame rectangle onto the renderer view window unchanged", () => {
    const viewport = { width: 1_600, height: 900 };
    const frame = resolveStudioBg3dCaptureFrame({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      aspectRatio: 1,
    })!;
    const offset = resolveStudioBg3dCaptureViewOffset({
      frame,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    })!;
    const unit = STUDIO_BG3D_CAPTURE_VIEW_OFFSET_UNIT;
    // 오버레이가 그리는 사각형과 렌더러가 자르는 창이 정규화 좌표에서 완전히 같아야 한다.
    expect(offset.offsetX / unit).toBeCloseTo(frame.x / viewport.width, 12);
    expect(offset.offsetY / unit).toBeCloseTo(frame.y / viewport.height, 12);
    expect(offset.width / unit).toBeCloseTo(frame.width / viewport.width, 12);
    expect(offset.height / unit).toBeCloseTo(frame.height / viewport.height, 12);
    expect(offset.fullWidth).toBe(unit);
    expect(offset.fullHeight).toBe(unit);
  });

  it("composes into an already-applied lens-shift window instead of replacing it", () => {
    const viewport = { width: 900, height: 1_600 };
    const frame = resolveStudioBg3dCaptureFrame({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      aspectRatio: 1,
    })!;
    const offset = resolveStudioBg3dCaptureViewOffset({
      frame,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      baseWindow: { offsetX: 0.2, offsetY: -0.1, width: 1, height: 1 },
    })!;
    const unit = STUDIO_BG3D_CAPTURE_VIEW_OFFSET_UNIT;
    expect(offset.offsetX / unit).toBeCloseTo(0.2 + frame.x / viewport.width, 12);
    expect(offset.offsetY / unit).toBeCloseTo(-0.1 + frame.y / viewport.height, 12);
    expect(offset.width / unit).toBeCloseTo(frame.width / viewport.width, 12);
  });

  it("rejects a frame that does not sit inside the viewport", () => {
    const frame = resolveStudioBg3dCaptureFrame({
      viewportWidth: 1_600,
      viewportHeight: 900,
      aspectRatio: 1,
    })!;
    expect(
      resolveStudioBg3dCaptureViewOffset({ frame, viewportWidth: 400, viewportHeight: 900 }),
    ).toBeNull();
    expect(
      resolveStudioBg3dCaptureViewOffset({
        frame: { ...frame, x: -10 },
        viewportWidth: 1_600,
        viewportHeight: 900,
      }),
    ).toBeNull();
  });
});

describe("capture frame ↔ capture size agreement", () => {
  it("resolves a capture raster whose aspect is the frame aspect, not the viewport aspect", () => {
    const viewport = { width: 1_512, height: 851 };
    const frame = resolveStudioBg3dCaptureFrame({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      aspectRatio: 1,
    })!;
    const size = resolveStudioBg3dLtCaptureSize({
      sourceWidth: viewport.width,
      sourceHeight: viewport.height,
      aspectRatio: frame.aspectRatio,
      requestedHeight: 1_080,
      maxPixels: 8_294_400,
    })!;
    expect(size).toMatchObject({ width: 1_080, height: 1_080 });
    expect(size.width / size.height).toBeCloseTo(frame.aspectRatio, 6);
  });

  it("produces the same raster for two different viewport sizes with the same fixed aspect", () => {
    const sizes = [
      { sourceWidth: 1_512, sourceHeight: 851 },
      { sourceWidth: 640, sourceHeight: 900 },
    ].map((viewport) => {
      const frame = resolveStudioBg3dCaptureFrame({
        viewportWidth: viewport.sourceWidth,
        viewportHeight: viewport.sourceHeight,
        aspectRatio: 16 / 9,
      })!;
      return resolveStudioBg3dLtCaptureSize({
        ...viewport,
        aspectRatio: frame.aspectRatio,
        requestedHeight: 1_080,
        maxPixels: 8_294_400,
      });
    });
    expect(sizes[0]).toEqual(sizes[1]);
    expect(sizes[0]).toMatchObject({ width: 1_920, height: 1_080 });
  });
});

describe("capture aspect presets", () => {
  it("offers the webtoon presets with the automatic entry first", () => {
    expect(STUDIO_BG3D_CAPTURE_ASPECT_PRESETS.map((preset) => preset.id)).toEqual([
      "viewport",
      "16-9",
      "4-3",
      "1-1",
      "3-4",
      "9-16",
    ]);
    expect(STUDIO_BG3D_CAPTURE_ASPECT_PRESETS[0]!.ratio).toBeNull();
    expect(STUDIO_BG3D_CAPTURE_ASPECT_PRESETS.map((preset) => preset.ratio).slice(1)).toEqual([
      16 / 9,
      4 / 3,
      1,
      3 / 4,
      9 / 16,
    ]);
    for (const preset of STUDIO_BG3D_CAPTURE_ASPECT_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      if (preset.ratio === null) continue;
      expect(preset.ratio).toBeGreaterThanOrEqual(STUDIO_BG3D_CAPTURE_ASPECT_MIN);
      expect(preset.ratio).toBeLessThanOrEqual(STUDIO_BG3D_CAPTURE_ASPECT_MAX);
    }
  });

  it("derives a document canvas preset and rejects unusable canvas sizes", () => {
    expect(createStudioBg3dDocumentCaptureAspectPreset(1_600, 2_400)).toMatchObject({
      id: "document",
      ratio: 1_600 / 2_400,
    });
    expect(createStudioBg3dDocumentCaptureAspectPreset(1_600, 2_400)!.label).toContain("1600×2400");
    expect(createStudioBg3dDocumentCaptureAspectPreset(0, 100)).toBeNull();
    expect(createStudioBg3dDocumentCaptureAspectPreset(undefined, undefined)).toBeNull();
  });

  it("matches a stored ratio back to its preset id", () => {
    expect(matchStudioBg3dCaptureAspectPreset(null)).toBe("viewport");
    expect(matchStudioBg3dCaptureAspectPreset(undefined)).toBe("viewport");
    expect(matchStudioBg3dCaptureAspectPreset(16 / 9)).toBe("16-9");
    expect(matchStudioBg3dCaptureAspectPreset(1)).toBe("1-1");
    expect(matchStudioBg3dCaptureAspectPreset(1.5)).toBe("custom");
    expect(matchStudioBg3dCaptureAspectPreset(Number.NaN)).toBe("custom");
  });
});

describe("normalizeStudioBg3dCaptureAspectRatio", () => {
  it("keeps in-range values, clamps out-of-range values, and drops corrupt values", () => {
    expect(normalizeStudioBg3dCaptureAspectRatio(16 / 9)).toBe(16 / 9);
    expect(normalizeStudioBg3dCaptureAspectRatio(1_000)).toBe(STUDIO_BG3D_CAPTURE_ASPECT_MAX);
    expect(normalizeStudioBg3dCaptureAspectRatio(0.001)).toBe(STUDIO_BG3D_CAPTURE_ASPECT_MIN);
    for (const corrupt of [null, undefined, "16/9", Number.NaN, Number.POSITIVE_INFINITY, 0, -1, {}]) {
      expect(normalizeStudioBg3dCaptureAspectRatio(corrupt)).toBeNull();
    }
  });

  it("is idempotent so canonical document round-trips stay stable", () => {
    for (const value of [16 / 9, 0.25, 4, 1, 1_000, 0.0001]) {
      const once = normalizeStudioBg3dCaptureAspectRatio(value);
      expect(normalizeStudioBg3dCaptureAspectRatio(once)).toBe(once);
    }
  });
});
