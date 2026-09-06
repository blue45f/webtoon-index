import { describe, expect, it, vi } from "vitest";

import {
  inferStudioVrmPhotoPoseFromImage,
  waitForStudioVrmPhotoPosePhase,
} from "./studio-vrm-photo-pose-inference";

import type { StudioVrmPhotoPosePreprocessedImage } from "./studio-vrm-photo-pose-worker-protocol";

function landmarks(): Array<{ x: number; y: number; z: number; visibility: number; presence: number }> {
  return Array.from({ length: 33 }, (_, index) => ({
    x: index / 100,
    y: index / 100,
    z: -index / 100,
    visibility: 0.9,
    presence: 0.9,
  }));
}

function handLandmarks(): Array<{ x: number; y: number; z: number }> {
  return Array.from({ length: 21 }, (_, index) => ({
    x: index / 100,
    y: index / 80,
    z: -index / 120,
  }));
}

function poseResult(close = vi.fn()) {
  return {
    landmarks: [landmarks()],
    worldLandmarks: [landmarks()],
    close,
  };
}

function handResult(labels: readonly ("Left" | "Right")[], close = vi.fn()) {
  return {
    landmarks: labels.map(() => handLandmarks()),
    worldLandmarks: labels.map(() => handLandmarks()),
    handedness: labels.map((categoryName) => [{ categoryName, score: 0.9 }]),
    close,
  };
}

function preprocessed(generationId = 3): StudioVrmPhotoPosePreprocessedImage {
  return {
    generationId,
    bitmap: { width: 32, height: 16, close: vi.fn() } as unknown as ImageBitmap,
    source: {
      mimeType: "image/png",
      width: 32,
      height: 16,
      pixelCount: 512,
      exifOrientation: 1,
      byteSize: 24,
    },
    output: {
      outputWidth: 32,
      outputHeight: 16,
      scale: 1,
      appliedExifOrientation: 1,
      rotation: 0,
      mirrorHorizontal: false,
    },
  };
}

describe("studio VRM photo-pose main-thread inference boundary", () => {
  it("stops waiting for model initialization when the scan-level signal is cancelled", async () => {
    let settleLate!: (value: string) => void;
    const latePhase = new Promise<string>((resolve) => {
      settleLate = resolve;
    });
    const controller = new AbortController();
    const result = waitForStudioVrmPhotoPosePhase(latePhase, controller.signal);

    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "aborted" });
    settleLate("late model");
    await Promise.resolve();

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(waitForStudioVrmPhotoPosePhase(Promise.resolve("unused"), preAborted.signal))
      .rejects.toMatchObject({ code: "aborted" });
  });

  it("returns copied numeric pose data without mutating state and closes the transferred bitmap", () => {
    const image = preprocessed();
    const rawLandmarks = landmarks();
    const close = vi.fn();
    const detector = {
      detect: vi.fn(() => ({
        landmarks: [rawLandmarks],
        worldLandmarks: [landmarks()],
        close,
      })),
    };
    const result = inferStudioVrmPhotoPoseFromImage(image, detector, { expectedGenerationId: 3 });

    expect(detector.detect).toHaveBeenCalledWith(image.bitmap);
    expect(result.inference.generationId).toBe(3);
    expect(result.inference.normalizedLandmarks).not.toBe(rawLandmarks);
    expect(result.hands.status).toBe("unavailable");
    expect(result.source).toBe(image.source);
    expect(close).toHaveBeenCalledOnce();
    expect(image.bitmap.close).toHaveBeenCalledOnce();
  });

  it("passes distinct A/B photo bitmaps to the inference provider without reusing the prior input", () => {
    const photoA = preprocessed(21);
    const photoB = preprocessed(22);
    const bitmapA = photoA.bitmap;
    const bitmapB = photoB.bitmap;
    const detector = { detect: vi.fn(() => poseResult()) };

    inferStudioVrmPhotoPoseFromImage(photoA, detector, { expectedGenerationId: 21 });
    inferStudioVrmPhotoPoseFromImage(photoB, detector, { expectedGenerationId: 22 });

    expect(bitmapA).not.toBe(bitmapB);
    expect(detector.detect.mock.calls).toEqual([[bitmapA], [bitmapB]]);
    expect(bitmapA.close).toHaveBeenCalledOnce();
    expect(bitmapB.close).toHaveBeenCalledOnce();
  });

  it("recognizes zero, one, and two optional hands on the same transferred bitmap", () => {
    for (const labels of [[], ["Left"], ["Left", "Right"]] as const) {
      const image = preprocessed();
      const closePose = vi.fn();
      const closeHands = vi.fn();
      const poseDetector = { detect: vi.fn(() => poseResult(closePose)) };
      const handDetector = { detect: vi.fn(() => handResult(labels, closeHands)) };
      const scan = inferStudioVrmPhotoPoseFromImage(image, poseDetector, {
        expectedGenerationId: 3,
        handDetector,
      });

      expect(poseDetector.detect).toHaveBeenCalledWith(image.bitmap);
      expect(handDetector.detect).toHaveBeenCalledWith(image.bitmap);
      expect(scan.hands.detectedSides).toHaveLength(labels.length);
      expect(closePose).toHaveBeenCalledOnce();
      expect(closeHands).toHaveBeenCalledOnce();
      expect(image.bitmap.close).toHaveBeenCalledOnce();
    }
  });

  it("keeps a valid body result when optional hand detection throws or returns malformed data", () => {
    const thrown = preprocessed(11);
    const thrownScan = inferStudioVrmPhotoPoseFromImage(
      thrown,
      { detect: () => poseResult() },
      {
        expectedGenerationId: 11,
        handDetector: { detect: () => { throw new Error("hand wasm failure"); } },
      },
    );
    expect(thrownScan.inference.bones.leftUpperArm).toBeDefined();
    expect(thrownScan.hands).toMatchObject({
      status: "unavailable",
      warnings: ["inference-failed"],
    });
    expect(thrown.bitmap.close).toHaveBeenCalledOnce();

    const malformed = preprocessed(12);
    const closeMalformed = vi.fn();
    const malformedScan = inferStudioVrmPhotoPoseFromImage(
      malformed,
      { detect: () => poseResult() },
      {
        expectedGenerationId: 12,
        handDetector: {
          detect: () => ({
            landmarks: [handLandmarks().slice(0, 20)],
            worldLandmarks: [handLandmarks()],
            handedness: [[{ categoryName: "Left", score: 0.9 }]],
            close: closeMalformed,
          }),
        },
      },
    );
    expect(malformedScan.hands.warnings).toEqual(["protocol"]);
    expect(closeMalformed).toHaveBeenCalledOnce();
    expect(malformed.bitmap.close).toHaveBeenCalledOnce();
  });

  it("rejects a generation superseded during hand inference and closes both raw results once", () => {
    const image = preprocessed(13);
    const closePose = vi.fn();
    const closeHands = vi.fn();
    let checks = 0;
    expect(() => inferStudioVrmPhotoPoseFromImage(
      image,
      { detect: () => poseResult(closePose) },
      {
        expectedGenerationId: 13,
        isGenerationCurrent: () => ++checks < 4,
        handDetector: { detect: () => handResult(["Left"], closeHands) },
      },
    )).toThrowError(expect.objectContaining({ code: "stale-generation" }));
    expect(closePose).toHaveBeenCalledOnce();
    expect(closeHands).toHaveBeenCalledOnce();
    expect(image.bitmap.close).toHaveBeenCalledOnce();
  });

  it("does not invoke MediaPipe for stale or pre-aborted generations and still closes the bitmap", () => {
    const stale = preprocessed(4);
    const detector = { detect: vi.fn() };
    expect(() => inferStudioVrmPhotoPoseFromImage(stale, detector, { expectedGenerationId: 5 }))
      .toThrowError(expect.objectContaining({ code: "stale-generation" }));
    expect(detector.detect).not.toHaveBeenCalled();
    expect(stale.bitmap.close).toHaveBeenCalledOnce();

    const aborted = preprocessed(6);
    const controller = new AbortController();
    controller.abort();
    expect(() => inferStudioVrmPhotoPoseFromImage(aborted, detector, {
      expectedGenerationId: 6,
      signal: controller.signal,
    })).toThrowError(expect.objectContaining({ code: "aborted" }));
    expect(aborted.bitmap.close).toHaveBeenCalledOnce();
  });

  it("rejects a generation superseded during inference and maps detector exceptions", () => {
    const superseded = preprocessed(7);
    let checks = 0;
    const close = vi.fn();
    const detector = {
      detect: vi.fn(() => ({
        landmarks: [landmarks()],
        worldLandmarks: [landmarks()],
        close,
      })),
    };
    expect(() => inferStudioVrmPhotoPoseFromImage(superseded, detector, {
      expectedGenerationId: 7,
      isGenerationCurrent: () => ++checks === 1,
    })).toThrowError(expect.objectContaining({ code: "stale-generation" }));
    expect(close).toHaveBeenCalledOnce();
    expect(superseded.bitmap.close).toHaveBeenCalledOnce();

    const failed = preprocessed(8);
    expect(() => inferStudioVrmPhotoPoseFromImage(
      failed,
      { detect: () => { throw new Error("wasm failure"); } },
      { expectedGenerationId: 8 },
    )).toThrowError(expect.objectContaining({ code: "inference-failed" }));
    expect(failed.bitmap.close).toHaveBeenCalledOnce();
  });

  it("closes malformed detector results and ignores cleanup failures after copying valid data", () => {
    const malformedImage = preprocessed(9);
    const closeMalformed = vi.fn();
    expect(() => inferStudioVrmPhotoPoseFromImage(
      malformedImage,
      { detect: () => ({ landmarks: [], worldLandmarks: [landmarks()], close: closeMalformed }) },
      { expectedGenerationId: 9 },
    )).toThrowError(expect.objectContaining({ code: "protocol" }));
    expect(closeMalformed).toHaveBeenCalledOnce();
    expect(malformedImage.bitmap.close).toHaveBeenCalledOnce();

    const validImage = preprocessed(10);
    const closeWithFailure = vi.fn(() => {
      throw new Error("already released");
    });
    const result = inferStudioVrmPhotoPoseFromImage(
      validImage,
      {
        detect: () => ({
          landmarks: [landmarks()],
          worldLandmarks: [landmarks()],
          close: closeWithFailure,
        }),
      },
      { expectedGenerationId: 10 },
    );
    expect(result.inference.generationId).toBe(10);
    expect(closeWithFailure).toHaveBeenCalledOnce();
    expect(validImage.bitmap.close).toHaveBeenCalledOnce();
  });
});
