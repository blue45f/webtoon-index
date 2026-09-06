// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioVrmPhotoPoseScanner } from "./StudioVrmPhotoPoseScanner";

const scannerRuntimeMocks = vi.hoisted(() => {
  const poseLandmarks = () => Array.from({ length: 33 }, (_, index) => ({
    x: index / 100,
    y: index / 90,
    z: -index / 120,
    visibility: 0.95,
    presence: 0.95,
  }));
  return {
    files: [] as File[],
    bitmaps: [] as ImageBitmap[],
    detector: {
      detect: vi.fn(() => ({
        landmarks: [poseLandmarks()],
        worldLandmarks: [poseLandmarks()],
        close: vi.fn(),
      })),
      close: vi.fn(),
    },
  };
});

vi.mock("./studio-vrm-photo-pose-worker-client", () => ({
  StudioVrmPhotoPosePreprocessor: class StudioVrmPhotoPosePreprocessorMock {
    currentGenerationId = 0;

    start(file: File, _options: unknown, startOptions: {
      readonly onProgress?: (progress: {
        readonly generationId: number;
        readonly progress: number;
        readonly stage: "ready";
      }) => void;
    }) {
      this.currentGenerationId += 1;
      const generationId = this.currentGenerationId;
      scannerRuntimeMocks.files.push(file);
      const bitmap = {
        close: vi.fn(),
        height: 48,
        sourceFileName: file.name,
        width: 64,
      } as unknown as ImageBitmap;
      scannerRuntimeMocks.bitmaps.push(bitmap);
      startOptions.onProgress?.({ generationId, progress: 1, stage: "ready" });
      return {
        generationId,
        cancel: vi.fn(),
        result: Promise.resolve({
          generationId,
          bitmap,
          source: {
            mimeType: file.type,
            width: 64,
            height: 48,
            pixelCount: 3_072,
            exifOrientation: 1,
            byteSize: file.size,
          },
          output: {
            outputWidth: 64,
            outputHeight: 48,
            scale: 1,
            appliedExifOrientation: 1,
            rotation: 0,
            mirrorHorizontal: false,
          },
        }),
      };
    }

    dispose(): void {}
  },
}));

vi.mock("./studio-vrm-webcam-tracking", () => ({
  disposePhotoHandLandmarker: vi.fn(),
  disposePhotoPoseLandmarker: vi.fn(),
  initPhotoHandLandmarker: vi.fn(async () => null),
  initPhotoPoseLandmarker: vi.fn(async () => scannerRuntimeMocks.detector),
}));

const source = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/vrm/StudioVrmPhotoPoseScanner.tsx"),
  "utf8",
);

beforeEach(() => {
  scannerRuntimeMocks.files.length = 0;
  scannerRuntimeMocks.bitmaps.length = 0;
  scannerRuntimeMocks.detector.detect.mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StudioVrmPhotoPoseScanner", () => {
  it("renders a local-only still-photo workflow with transform controls", () => {
    const html = renderToStaticMarkup(<StudioVrmPhotoPoseScanner onApply={vi.fn(() => true)} />);
    expect(html).toContain("사진 포즈 스캔");
    expect(html).toContain("서버로 보내지 않고");
    expect(html).toContain("사진 회전");
    expect(html).toContain("좌우 반전");
    expect(html).toContain("전신 포즈");
    expect(html).toContain("image/jpeg,image/png,image/webp");
  });

  it("disables file admission when the poser has no usable character", () => {
    const html = renderToStaticMarkup(<StudioVrmPhotoPoseScanner disabled onApply={() => false} />);
    expect(html).toContain("disabled");
    expect(source).toContain('disabled={disabled}');
    expect(source).toContain('if (applied) setCandidate(null)');
  });

  it("keeps hand inference optional and commits fingers only through explicit apply", () => {
    expect(source).toContain("initPhotoHandLandmarker()");
    expect(source).toContain("disposePhotoHandLandmarker()");
    expect(source).toContain("STUDIO_VRM_PHOTO_HAND_INIT_BUDGET_MS");
    expect(source).toContain("인식한 손가락도 함께 적용");
    expect(source).toContain("손 미검출 · 기존 손 유지");
    expect(source).toContain("fingerEdits: includeHandDetection && includeFingerEdits");
    expect(source).toContain("detectedHandSides: includeHandDetection && includeFingerEdits");
  });

  it("keeps every visible scanner action at least 44px tall", () => {
    expect(source.match(/min-h-11/gu)?.length).toBeGreaterThanOrEqual(5);
    expect(source).toContain('className="h-11 w-full');
  });

  it("supports a body-only mannequin lane and fail-closes low-confidence apply", () => {
    const html = renderToStaticMarkup(
      <StudioVrmPhotoPoseScanner
        includeHandDetection={false}
        minimumApplyQuality="medium"
        onApply={() => true}
      />,
    );
    expect(html).toContain("한 사람의 전신 포즈");
    expect(source).toMatch(/includeHandDetection\s*\? waitForOptionalPhotoHandDetector/u);
    expect(source).toContain("disabled={disabled || !candidateMeetsMinimum}");
    expect(source).toContain("worldLandmarks: candidate.worldLandmarks");

    expect(source).toContain("PHOTO_POSE_QUALITY_RANK[confidence.quality]");
    expect(source).toContain("PHOTO_POSE_QUALITY_RANK[minimumQuality]");
    expect(source).toContain("신뢰도가 적용 기준보다 낮습니다");
  });

  it("routes the actual selected A/B files to distinct provider bitmap inputs", async () => {
    const { container } = render(
      <StudioVrmPhotoPoseScanner includeHandDetection={false} onApply={() => true} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const fileA = new File([new Uint8Array([1, 2, 3])], "pose-a.png", { type: "image/png" });
    const fileB = new File([new Uint8Array([4, 5, 6, 7])], "pose-b.png", { type: "image/png" });

    fireEvent.change(input!, { target: { files: [fileA] } });
    await waitFor(() => expect(scannerRuntimeMocks.detector.detect).toHaveBeenCalledTimes(1));
    fireEvent.change(input!, { target: { files: [fileB] } });
    await waitFor(() => expect(scannerRuntimeMocks.detector.detect).toHaveBeenCalledTimes(2));

    expect(scannerRuntimeMocks.files).toEqual([fileA, fileB]);
    expect(scannerRuntimeMocks.bitmaps[0]).not.toBe(scannerRuntimeMocks.bitmaps[1]);
    expect(scannerRuntimeMocks.detector.detect.mock.calls).toEqual([
      [scannerRuntimeMocks.bitmaps[0]],
      [scannerRuntimeMocks.bitmaps[1]],
    ]);
  });

  it("scans an image handed over by the surrounding surface without a second file pick", async () => {
    const file = new File([new Uint8Array([9, 9, 9])], "handed.png", { type: "image/png" });
    const { rerender } = render(
      <StudioVrmPhotoPoseScanner
        includeHandDetection={false}
        handoff={{ file, token: 1 }}
        onApply={() => true}
      />,
    );

    await waitFor(() => expect(scannerRuntimeMocks.detector.detect).toHaveBeenCalledTimes(1));
    expect(scannerRuntimeMocks.files).toEqual([file]);

    // A re-render with the same token must not rescan — the creator is looking at the result.
    rerender(
      <StudioVrmPhotoPoseScanner
        includeHandDetection={false}
        handoff={{ file, token: 1 }}
        onApply={() => true}
      />,
    );
    expect(scannerRuntimeMocks.detector.detect).toHaveBeenCalledTimes(1);

    // A new token is how the surface says "read this one again".
    rerender(
      <StudioVrmPhotoPoseScanner
        includeHandDetection={false}
        handoff={{ file, token: 2 }}
        onApply={() => true}
      />,
    );
    await waitFor(() => expect(scannerRuntimeMocks.detector.detect).toHaveBeenCalledTimes(2));
  });

  it("ignores a handed-over image while the scanner is disabled", async () => {
    const file = new File([new Uint8Array([1])], "blocked.png", { type: "image/png" });
    render(
      <StudioVrmPhotoPoseScanner
        disabled
        includeHandDetection={false}
        handoff={{ file, token: 1 }}
        onApply={() => true}
      />,
    );

    await Promise.resolve();
    expect(scannerRuntimeMocks.detector.detect).not.toHaveBeenCalled();
    expect(scannerRuntimeMocks.files).toEqual([]);
  });
});
