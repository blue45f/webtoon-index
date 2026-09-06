import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const studioPageSource = readFileSync(
  new URL("../StudioCuttoonEditorHost.tsx", import.meta.url),
  "utf8",
);

describe("Studio layer semantic projection boundary", () => {
  it("keeps VRM and background-3D image containers visually distinct from raster art", () => {
    const projectionStart = studioPageSource.indexOf(
      "const layerNavigatorItems: StudioLayerNavigatorItem[]",
    );
    const projectionEnd = studioPageSource.indexOf(
      "const selectedBubbleTailGeometry",
      projectionStart,
    );
    const projection = studioPageSource.slice(projectionStart, projectionEnd);

    expect(projectionStart).toBeGreaterThanOrEqual(0);
    expect(projectionEnd).toBeGreaterThan(projectionStart);
    expect(projection).toContain(
      'element.type === "image" && (element.bg3dScene || element.vrmScene)',
    );
    expect(projection).toContain('? "three-d"');
  });
});
