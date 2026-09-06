import { describe, expect, it } from "vitest";

import { normalizeStudioPersistedPointerChannels } from "./studio-persisted-pointer-channels";

describe("normalizeStudioPersistedPointerChannels", () => {
  it("keeps bounded pen orientation, contact geometry and gesture-relative time", () => {
    expect(normalizeStudioPersistedPointerChannels({
      pointerType: "pen",
      altitudeAngle: 0.75,
      azimuthAngle: 2.5,
      width: 4.5,
      height: 2.25,
      timeStamp: 1_025,
    }, {
      timeOriginMilliseconds: 1_000,
    })).toEqual({
      altitudeAngle: 0.75,
      azimuthAngle: 2.5,
      contactWidth: 4.5,
      contactHeight: 2.25,
      timeOffsetMilliseconds: 25,
    });
  });

  it("uses neutral orientation for non-pen input while retaining touch contact geometry", () => {
    expect(normalizeStudioPersistedPointerChannels({
      pointerType: "touch",
      altitudeAngle: 0.2,
      azimuthAngle: 1.5,
      width: 18,
      height: 22,
      timeStamp: 80,
    }, {
      timeOriginMilliseconds: 50,
    })).toEqual({
      altitudeAngle: Math.PI / 2,
      azimuthAngle: 0,
      contactWidth: 18,
      contactHeight: 22,
      timeOffsetMilliseconds: 30,
    });
  });

  it("neutralizes invalid optional fields and clamps a regressing clock monotonically", () => {
    expect(normalizeStudioPersistedPointerChannels({
      pointerType: "pen",
      altitudeAngle: Number.NaN,
      azimuthAngle: -1,
      width: Number.POSITIVE_INFINITY,
      height: -1,
      timeStamp: 90,
    }, {
      timeOriginMilliseconds: 100,
      previousTimeOffsetMilliseconds: 12,
    })).toEqual({
      altitudeAngle: Math.PI / 2,
      azimuthAngle: 0,
      contactWidth: 1,
      contactHeight: 1,
      timeOffsetMilliseconds: 12,
    });
  });
});
