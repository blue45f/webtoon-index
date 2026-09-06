import { describe, expect, it, vi } from "vitest";

import {
  decodeStudioCompanionReferenceWorkerDataUrl,
  installStudioCompanionReferenceRasterWorker,
} from "./studio-companion-reference-raster-worker";
import { STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_DATA_URL_CHARS } from "./studio-companion-reference-raster-worker-protocol";

describe("Studio companion reference raster worker data URL decoder", () => {
  it("decodes base64, raw UTF-8, and percent bytes into bounded typed buffers", () => {
    expect([...decodeStudioCompanionReferenceWorkerDataUrl(
      "data:application/octet-stream;base64,AQID"
    )]).toEqual([1, 2, 3]);
    expect([...decodeStudioCompanionReferenceWorkerDataUrl("data:text/plain,A한")])
      .toEqual([...new TextEncoder().encode("A한")]);
    expect([...decodeStudioCompanionReferenceWorkerDataUrl(
      "data:application/octet-stream,%41%FF"
    )]).toEqual([65, 255]);
  });

  it("rejects oversized base64, raw, and percent URLs before allocating decoded output", () => {
    const oversizedPayload = "A".repeat(
      STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_DATA_URL_CHARS
    );

    expect(() => decodeStudioCompanionReferenceWorkerDataUrl(
      `data:application/octet-stream;base64,${oversizedPayload}`
    )).toThrow("oversized");
    expect(() => decodeStudioCompanionReferenceWorkerDataUrl(
      `data:text/plain,${oversizedPayload}`
    )).toThrow("oversized");
    expect(() => decodeStudioCompanionReferenceWorkerDataUrl(
      `data:text/plain,%41${oversizedPayload}`
    )).toThrow("oversized");
  });
});

describe("Studio companion reference raster worker errors", () => {
  it("responds to malformed jobs immediately instead of waiting for the client deadline", async () => {
    let listener: ((event: MessageEvent<unknown>) => void) | null = null;
    const postMessage = vi.fn();
    installStudioCompanionReferenceRasterWorker({
      addEventListener: (_type, nextListener) => { listener = nextListener; },
      postMessage,
    });

    const dispatch = listener as unknown as (event: MessageEvent<unknown>) => void;
    dispatch({
      data: {
        kind: "hash",
        jobId: "malformed-job",
        epoch: 1,
        deadlineAt: Date.now() + 8_000,
        dataUrl: "data:text/plain,bad%2",
      },
    } as MessageEvent<unknown>);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      kind: "job-error",
      jobId: "malformed-job",
      epoch: 1,
      code: "invalid-input",
    }));
  });

  it("rechecks the deadline after an exact-size copy and before publishing output", async () => {
    let listener: ((event: MessageEvent<unknown>) => void) | null = null;
    const postMessage = vi.fn();
    const now = vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValue(3_000);
    installStudioCompanionReferenceRasterWorker({
      addEventListener: (_type, nextListener) => { listener = nextListener; },
      postMessage,
    });

    const dispatch = listener as unknown as (event: MessageEvent<unknown>) => void;
    dispatch({
      data: {
        kind: "normalize",
        jobId: "late-copy",
        epoch: 1,
        deadlineAt: 2_000,
        width: 1,
        height: 1,
        maximumOutputPixels: 1,
        buffer: new Uint8ClampedArray([1, 2, 3, 255]).buffer,
      },
    } as MessageEvent<unknown>);

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      kind: "job-error",
      jobId: "late-copy",
      epoch: 1,
      code: "deadline",
    }));
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: "normalize-result",
    }), expect.anything());
    now.mockRestore();
  });
});
