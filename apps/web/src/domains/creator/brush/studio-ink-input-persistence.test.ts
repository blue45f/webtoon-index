import { describe, expect, it } from "vitest";

import {
  StudioCrdtDocument,
  type StudioCrdtJsonObject,
  type StudioCrdtStrokeRecord,
} from "../live/studio-crdt-document";
import {
  studioCrdtStrokeToDrawElement,
  studioDrawElementToCrdtStroke,
} from "../live/studio-crdt-page-bridge";

import {
  captureStudioInkInputContractV1,
  captureStudioInkInputContractV2,
} from "@/shared/lib/studio-ink-input-contract";

function finalizedRecord(
  input: ReturnType<typeof studioDrawElementToCrdtStroke>,
): StudioCrdtStrokeRecord {
  return {
    ...input,
    orderIndex: 0,
    status: "finalized",
    deleted: false,
  };
}

describe("Studio ink input persistence", () => {
  it("round-trips input provenance and aligned sensor samples through the CRDT document", () => {
    const inkInput = captureStudioInkInputContractV1("pen");
    const encoded = studioDrawElementToCrdtStroke("page-a", {
      id: "sensor-stroke",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [0.25, 0.75],
      tiltXs: [12, 34],
      tiltYs: [-21, -43],
      twists: [45, 270],
      speeds: [0, 2.75],
      tangentialPressures: [-0.2, 0.6],
      stroke: "#123456",
      strokeWidth: 9,
      brush: "pen",
      inkInput,
    });

    expect(encoded.payload.extensions?.inkInput).toEqual(inkInput);
    const document = new StudioCrdtDocument();
    document.beginStroke(encoded);
    document.finalizeStroke(encoded.id);
    const record = document.getStroke(encoded.id);
    expect(record).not.toBeNull();

    const restored = studioCrdtStrokeToDrawElement(record!);
    expect(restored.inkInput).toEqual(inkInput);
    expect(restored.pressures).toEqual([0.25, 0.75]);
    expect(restored.tiltXs).toEqual([12, 34]);
    expect(restored.tiltYs).toEqual([-21, -43]);
    expect(restored.twists).toEqual([45, 270]);
    expect(restored.speeds).toEqual([0, 2.75]);
    expect(restored.tangentialPressures).toEqual([-0.2, 0.6]);
    document.destroy();
  });

  it("streams and remotely replays aligned v2 authoritative channels", () => {
    const encoded = studioDrawElementToCrdtStroke("page-a", {
      id: "sensor-stroke-v2",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2],
      pressures: [0.25],
      tiltXs: [12],
      tiltYs: [-21],
      twists: [45],
      speeds: [0],
      tangentialPressures: [-0.2],
      altitudeAngles: [0.7],
      azimuthAngles: [1.2],
      contactWidths: [3],
      contactHeights: [2],
      sampleTimeOffsets: [0],
      stroke: "#123456",
      strokeWidth: 9,
      brush: "pen",
      inkInput: captureStudioInkInputContractV2("pen"),
    });
    const source = new StudioCrdtDocument();
    source.beginStroke(encoded);
    source.appendStrokeSamples(encoded.id, {
      points: [3, 4],
      pressures: [0.75],
      tiltXs: [34],
      tiltYs: [-43],
      twists: [270],
      speeds: [2.75],
      tangentialPressures: [0.6],
      altitudeAngles: [0.45],
      azimuthAngles: [2.4],
      contactWidths: [4],
      contactHeights: [2.5],
      sampleTimeOffsets: [8.5],
    });
    expect(() => source.appendStrokeSamples(encoded.id, {
      points: [5, 6],
      pressures: [0.8],
      tiltXs: [30],
      tiltYs: [-40],
      twists: [280],
      speeds: [2],
      tangentialPressures: [0.5],
      altitudeAngles: [0.4],
      azimuthAngles: [2.5],
      contactWidths: [4],
      contactHeights: [2.5],
      sampleTimeOffsets: [7],
    })).toThrow("기존 권위 샘플보다 앞섭니다");
    expect(() => source.appendStrokeSamples(encoded.id, {
      points: [5, 6],
      pressures: [0.8],
      tiltXs: [30],
      tiltYs: [-40],
      twists: [280],
      speeds: [2],
      tangentialPressures: [0.5],
    })).toThrow("v2 획 입력 센서 채널이 누락되었습니다");
    source.finalizeStroke(encoded.id);

    const remote = new StudioCrdtDocument();
    remote.applyUpdate(source.encodeStateAsUpdate());
    const restoredRecord = remote.getStroke(encoded.id);
    expect(restoredRecord).not.toBeNull();
    const restored = studioCrdtStrokeToDrawElement(restoredRecord!);
    expect(restored.inkInput).toMatchObject({ version: 2 });
    expect(restored.altitudeAngles).toEqual([0.7, 0.45]);
    expect(restored.azimuthAngles).toEqual([1.2, 2.4]);
    expect(restored.contactWidths).toEqual([3, 4]);
    expect(restored.contactHeights).toEqual([2, 2.5]);
    expect(restored.sampleTimeOffsets).toEqual([0, 8.5]);
    source.destroy();
    remote.destroy();
  });

  it("fails closed for malformed or contradictory sensor semantics", () => {
    const canonical = captureStudioInkInputContractV1("pen");
    expect(() => studioDrawElementToCrdtStroke("page-a", {
      id: "malformed-sensor-stroke",
      type: "draw",
      points: [1, 2],
      stroke: "#123456",
      strokeWidth: 9,
      inkInput: {
        ...canonical,
        pressureSource: "simulated",
      },
    })).toThrow("획 입력 센서 계약이 올바르지 않습니다");

    const valid = studioDrawElementToCrdtStroke("page-a", {
      id: "future-sensor-stroke",
      type: "draw",
      points: [1, 2],
      stroke: "#123456",
      strokeWidth: 9,
      inkInput: canonical,
    });
    const futureContract = {
      ...canonical,
      version: 3,
    } as unknown as StudioCrdtJsonObject;
    expect(() => studioCrdtStrokeToDrawElement(finalizedRecord({
      ...valid,
      payload: {
        ...valid.payload,
        extensions: {
          ...valid.payload.extensions,
          inkInput: futureContract,
        },
      },
    }))).toThrow("획 입력 센서 계약이 올바르지 않습니다");
  });
});
