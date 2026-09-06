import { describe, expect, it } from "vitest";

import { processFreehandPoints } from "../studio-brush";

import { processFreehandPointsInWorker } from "./studio-brush-worker-client";
import { STUDIO_BRUSH_WORKER_PROTOCOL_VERSION } from "./studio-brush-worker-protocol";

describe("studio-brush-worker-protocol & client", () => {
  it("defines protocol version 1", () => {
    expect(STUDIO_BRUSH_WORKER_PROTOCOL_VERSION).toBe(1);
  });

  it("falls back gracefully when Web Worker is not available in node test environment", async () => {
    const raw = [10, 10, 12, 12, 30, 30, 50, 50];
    const res = await processFreehandPointsInWorker(raw, 3, "pen", 6, 42);
    expect(res).toEqual(processFreehandPoints(raw, 3));
  });
});
