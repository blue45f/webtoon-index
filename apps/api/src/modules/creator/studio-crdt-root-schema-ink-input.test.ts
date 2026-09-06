import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  captureStudioInkInputContractV1,
  captureStudioInkInputContractV2,
} from "../../../../web/src/shared/lib/studio-ink-input-contract";

import { hasValidStudioCrdtRootSchema } from "./studio-crdt-root-schema";

function strokeDocument(
  inkInput: unknown,
  options: Readonly<{
    extended?: boolean;
    sampleTimeOffsets?: readonly number[];
    azimuthAngles?: readonly number[];
  }> = {},
): Y.Doc {
  const doc = new Y.Doc();
  const stroke = new Y.Map<unknown>();
  stroke.set("id", "sensor-stroke");
  stroke.set("pageId", "page-1");
  stroke.set("layerId", "page-root");
  stroke.set("status", "finalized");
  stroke.set("deleted", false);
  stroke.set("payloadVersion", 1);
  stroke.set("type", "draw");
  stroke.set("mode", "pen");
  stroke.set("kind", "freehand");
  stroke.set("stroke", "#111111");
  stroke.set("strokeWidth", 8);
  stroke.set("extensions", { inkInput });
  const channels = new Map<string, Y.Array<number>>();
  for (const key of [
    "points",
    "pressures",
    "tiltXs",
    "tiltYs",
    "twists",
    "speeds",
    "tangentialPressures",
  ]) {
    const channel = new Y.Array<number>();
    channels.set(key, channel);
    stroke.set(key, channel);
  }
  if (options.extended) {
    for (const [key, values] of Object.entries({
      altitudeAngles: options.sampleTimeOffsets?.map(() => 0.5) ?? [],
      azimuthAngles: options.azimuthAngles ?? [],
      contactWidths: options.sampleTimeOffsets?.map(() => 2) ?? [],
      contactHeights: options.sampleTimeOffsets?.map(() => 3) ?? [],
      sampleTimeOffsets: options.sampleTimeOffsets ?? [],
    })) {
      const channel = new Y.Array<number>();
      channel.push([...values]);
      stroke.set(key, channel);
    }
    const pointCount = options.sampleTimeOffsets?.length ?? 0;
    for (const key of [
      "pressures",
      "tiltXs",
      "tiltYs",
      "twists",
      "speeds",
      "tangentialPressures",
    ]) {
      channels.get(key)!.push(Array<number>(pointCount).fill(0));
    }
    channels.get("points")!.push(Array<number>(pointCount * 2).fill(0));
  }
  doc.getMap<Y.Map<unknown>>("strokes").set("sensor-stroke", stroke);

  const order = new Y.Map<unknown>();
  order.set("strokeId", "sensor-stroke");
  order.set("pageId", "page-1");
  order.set("layerId", "page-root");
  order.set("active", true);
  doc.getArray<Y.Map<unknown>>("stroke-order").push([order]);
  return doc;
}

describe("Studio CRDT root ink input contract", () => {
  it("accepts the canonical vendor-neutral contract", () => {
    const doc = strokeDocument(captureStudioInkInputContractV1("pen"));
    expect(hasValidStudioCrdtRootSchema(doc)).toBe(true);
    doc.destroy();
  });

  it("accepts v2 only with aligned bounded authoritative extended channels", () => {
    const doc = strokeDocument(captureStudioInkInputContractV2("pen"), {
      extended: true,
      sampleTimeOffsets: [0, 8, 16],
      azimuthAngles: [0.2, 1.2, 2.2],
    });
    expect(hasValidStudioCrdtRootSchema(doc)).toBe(true);
    doc.destroy();
  });

  it("keeps v1 compatible without silently accepting a v2 channel omission", () => {
    const v1 = strokeDocument(captureStudioInkInputContractV1("pen"));
    const v2 = strokeDocument(captureStudioInkInputContractV2("pen"));
    expect(hasValidStudioCrdtRootSchema(v1)).toBe(true);
    expect(hasValidStudioCrdtRootSchema(v2)).toBe(false);
    v1.destroy();
    v2.destroy();
  });

  it.each([
    ["regressing time", [0, 9, 8], [0.2, 1.2, 2.2]],
    ["non-zero time origin", [1, 9, 18], [0.2, 1.2, 2.2]],
    ["full-turn azimuth", [0, 9, 18], [0.2, Math.PI * 2, 2.2]],
  ])("rejects v2 %s", (_, sampleTimeOffsets, azimuthAngles) => {
    const doc = strokeDocument(captureStudioInkInputContractV2("pen"), {
      extended: true,
      sampleTimeOffsets,
      azimuthAngles,
    });
    expect(hasValidStudioCrdtRootSchema(doc)).toBe(false);
    doc.destroy();
  });

  it.each([
    ["future version", { version: 3 }],
    ["contradictory pressure source", { pressureSource: "simulated" }],
    ["fingerprinting field", { vendorDeviceId: "private-device" }],
  ])("rejects %s at the server boundary", (_, patch) => {
    const doc = strokeDocument({
      ...captureStudioInkInputContractV1("pen"),
      ...patch,
    });
    expect(hasValidStudioCrdtRootSchema(doc)).toBe(false);
    doc.destroy();
  });
});
