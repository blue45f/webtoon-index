import { describe, expect, it } from "vitest";

import {
  assertStudioRetouchWorkerRequest,
  STUDIO_RETOUCH_MAX_IMAGE_PIXELS,
  studioRetouchRequestTransfers,
  studioRetouchSuccessTransfers,
  type StudioRetouchWorkerRunMessage,
  type StudioRetouchWorkerSuccessMessage,
} from "./studio-retouch-worker-protocol";

function message(): StudioRetouchWorkerRunMessage {
  return {
    type: "studio-retouch/run",
    version: 1,
    request: {
      kind: "dodge-burn",
      data: new Uint8ClampedArray(4 * 4 * 4),
      w: 4,
      h: 4,
      points: [{ x: 2, y: 2 }],
      settings: {
        radiusPx: 2,
        hardness: 0.5,
        exposure: 50,
        mode: "dodge",
        range: "midtones",
        sponge: "saturate",
      },
    },
  };
}

describe("Studio retouch Worker protocol", () => {
  it("accepts canonical requests and transfers each owned pixel buffer exactly once", () => {
    const request = message();
    expect(() => assertStudioRetouchWorkerRequest(request.request)).not.toThrow();
    expect(studioRetouchRequestTransfers(request)).toEqual([request.request.data.buffer]);

    const response: StudioRetouchWorkerSuccessMessage = {
      type: "studio-retouch/success",
      version: 1,
      kind: request.request.kind,
      data: request.request.data,
      w: request.request.w,
      h: request.request.h,
    };
    expect(studioRetouchSuccessTransfers(response)).toEqual([response.data.buffer]);
  });

  it("rejects malformed dimensions, buffers, settings, points and oversized rasters", () => {
    const valid = message().request;
    expect(() => assertStudioRetouchWorkerRequest({
      ...valid,
      data: new Uint8ClampedArray(4),
    })).toThrow(/버퍼 길이/u);
    expect(() => assertStudioRetouchWorkerRequest({ ...valid, w: 0 })).toThrow(/크기/u);
    expect(() => assertStudioRetouchWorkerRequest({
      ...valid,
      w: STUDIO_RETOUCH_MAX_IMAGE_PIXELS + 1,
      h: 1,
      data: new Uint8ClampedArray(0),
    })).toThrow(/Worker 안전 한도/u);
    expect(() => assertStudioRetouchWorkerRequest({
      ...valid,
      points: [{ x: Number.NaN, y: 1 }],
    })).toThrow(/x 좌표/u);
    expect(() => assertStudioRetouchWorkerRequest({
      ...valid,
      settings: { ...valid.settings, hardness: 2 },
    })).toThrow(/경도/u);
  });
});
