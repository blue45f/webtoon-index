// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runStudioSvgExportWorker } from "./studio-svg-export-worker-client";

describe("SVG export outline-engine preparation", () => {
  const gpenInput = {
    width: 96,
    height: 72,
    bg: "#ffffff",
    transparentBg: true,
    elements: [{
      id: "worker-first-gpen",
      type: "draw" as const,
      kind: "freehand" as const,
      mode: "pen" as const,
      brush: "gpen",
      points: [4, 40, 16, 12, 34, 4, 54, 18, 70, 42, 86, 30],
      pressures: [0.18, 0.42, 0.82, 0.94, 0.58, 0.25],
      sampleSpacing: 1,
      stroke: "#203040",
      strokeWidth: 11,
      opacity: 1,
    }],
  };

  it("prepares perfect-freehand before an explicitly selected direct export", async () => {
    const result = await runStudioSvgExportWorker(gpenInput, {
      executionBackend: "direct",
    });

    expect(result.execution).toBe("direct");
    expect(result.result.svg).toContain('data-brush-engine="perfect-outline"');
    expect(result.result.svg).toContain('data-brush-variant="gpen"');
    expect(result.result.svg).not.toContain('stroke-width="11" stroke-linecap="round"');
  });

  it("awaits the outline chunk before serialization inside every short-lived module Worker", () => {
    const workerSource = readFileSync(
      new URL("./studio-svg-export.worker.ts", import.meta.url),
      "utf8",
    );
    const prepareIndex = workerSource.indexOf("await loadStudioPerfectFreehandStroker()");
    const serializeIndex = workerSource.indexOf("exportPageToSvg(message.input)");

    expect(prepareIndex).toBeGreaterThan(-1);
    expect(serializeIndex).toBeGreaterThan(prepareIndex);
  });
});
