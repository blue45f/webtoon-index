// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  acknowledgeStudioRasterImagePresentation,
  acknowledgeStudioRasterImagePresentationDraw,
  expectStudioRasterImagePresentation,
  expectedStudioRasterImagePresentation,
  registerStudioMountedRasterImagePresentation,
  snapshotStudioMountedRasterImagePresentations,
  STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION,
  waitForStudioRasterImagePresentations,
} from "./studio-raster-image-presentation";

function armProbe(): void {
  window.__studioRasterImagePresentationProbe = {
    version: STUDIO_RASTER_IMAGE_PRESENTATION_PROBE_VERSION,
    expectationEpoch: 0,
    expected: null,
    receiptEpoch: 0,
    receipt: null,
  };
}

afterEach(() => {
  delete window.__studioHotPathRenderCounters;
  delete window.__studioRasterImagePresentationProbe;
});

describe("studio raster image presentation probe", () => {
  it("has no receipt work when the browser verifier is not armed", () => {
    expect(expectStudioRasterImagePresentation({ elementId: "image-1", src: "src-a" }))
      .toBeNull();
    expect(expectedStudioRasterImagePresentation({ elementId: "image-1", src: "src-a" }))
      .toBeNull();
  });

  it("rejects stale identities and receipts the exact current epoch with render counters", () => {
    armProbe();
    window.__studioHotPathRenderCounters = { "studio:canvas": 7, "studio:editor": 9 };
    const first = expectStudioRasterImagePresentation({ elementId: "image-1", src: "src-a" });
    const second = expectStudioRasterImagePresentation({ elementId: "image-1", src: "src-b" });

    expect(first?.epoch).toBe(1);
    expect(second?.epoch).toBe(2);
    expect(expectedStudioRasterImagePresentation({ elementId: "image-1", src: "src-a" }))
      .toBeNull();
    expect(acknowledgeStudioRasterImagePresentation(first!)).toBeNull();

    const receipt = acknowledgeStudioRasterImagePresentation(second!);
    expect(receipt).toMatchObject({
      elementId: "image-1",
      expectationEpoch: 2,
      receiptEpoch: 1,
      renderCounters: { "studio:canvas": 7, "studio:editor": 9 },
      src: "src-b",
    });
    expect(receipt?.presentedAt).toEqual(expect.any(Number));
    expect(receipt?.presentedWallClockMs).toEqual(expect.any(Number));
    expect(acknowledgeStudioRasterImagePresentation(second!)).toBe(receipt);
  });

  it("closes a product fence only after every exact identity is drawn after arming", async () => {
    const requestDraw = () => {
      acknowledgeStudioRasterImagePresentationDraw({ elementId: "line-1", src: "locator-a" });
      acknowledgeStudioRasterImagePresentationDraw({ elementId: "line-2", src: "stale" });
      queueMicrotask(() => {
        acknowledgeStudioRasterImagePresentationDraw({ elementId: "line-2", src: "locator-b" });
      });
    };

    await expect(waitForStudioRasterImagePresentations([
      { elementId: "line-1", src: "locator-a" },
      { elementId: "line-2", src: "locator-b" },
    ], requestDraw)).resolves.toBeUndefined();
  });

  it("releases a pending product fence when its capture operation is aborted", async () => {
    const controller = new AbortController();
    const pending = waitForStudioRasterImagePresentations(
      [{ elementId: "line-1", src: "locator-a" }],
      () => undefined,
      controller.signal,
    );
    controller.abort(new Error("capture cancelled"));
    await expect(pending).rejects.toThrow("capture cancelled");

    acknowledgeStudioRasterImagePresentationDraw({ elementId: "line-1", src: "locator-a" });
  });

  it("snapshots only currently mounted canonical identities and reference-counts duplicate mounts", () => {
    const releaseFirst = registerStudioMountedRasterImagePresentation({
      elementId: "line-1",
      src: "locator-a",
    });
    const releaseDuplicate = registerStudioMountedRasterImagePresentation({
      elementId: "line-1",
      src: "locator-a",
    });
    const releaseSecond = registerStudioMountedRasterImagePresentation({
      elementId: "line-2",
      src: "locator-b",
    });
    expect(snapshotStudioMountedRasterImagePresentations()).toEqual([
      { elementId: "line-1", src: "locator-a" },
      { elementId: "line-2", src: "locator-b" },
    ]);

    releaseFirst();
    expect(snapshotStudioMountedRasterImagePresentations()).toContainEqual({
      elementId: "line-1",
      src: "locator-a",
    });
    releaseDuplicate();
    releaseSecond();
    expect(snapshotStudioMountedRasterImagePresentations()).toEqual([]);
  });
});
