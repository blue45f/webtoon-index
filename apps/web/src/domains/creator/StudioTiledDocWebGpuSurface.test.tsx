import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  StudioTiledDocWebGpuSurface,
} from "./StudioTiledDocWebGpuSurface";

describe("StudioTiledDocWebGpuSurface product ownership", () => {
  it("renders one hidden bounded document island before two-phase authority is granted", () => {
    const html = renderToStaticMarkup(
      <StudioTiledDocWebGpuSurface
        generation={1}
        surface={{
          version: 1,
          surfaceId: "raster:page:ink",
          width: 8192,
          height: 8192,
          tileSize: 512,
        }}
        tiles={[]}
        viewport={{
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
          flipX: false,
          surfaceBounds: { left: 10, top: 20, width: 512, height: 512 },
        }}
        documentViewport={{ x: 0, y: 0, width: 512, height: 512 }}
      />
    );
    expect(html).toContain('data-studio-tiledoc-product-island="true"');
    expect(html).toContain('data-studio-primary-surface-owner="none"');
    expect(html).toContain('data-studio-tiledoc-webgpu-status="pending"');
    expect((html.match(/data-studio-tiledoc-webgpu-canvas=/gu) ?? [])).toHaveLength(1);
    expect(html).not.toContain("canvas2d-fallback");
  });

  it("wires the existing CRDT raster product island to tiledoc without taking Vello selection ownership", () => {
    const surfaceSource = readFileSync(
      new URL("./StudioRasterCrdtSurface.tsx", import.meta.url),
      "utf8"
    );
    const tiledocSource = readFileSync(
      new URL("./StudioTiledDocWebGpuSurface.tsx", import.meta.url),
      "utf8"
    );
    expect(surfaceSource).toContain("<StudioTiledDocWebGpuSurface");
    expect(surfaceSource).toContain("documentViewport={visibleDocumentRect}");
    expect((surfaceSource.match(/<StudioTiledDocWebGpuSurface/gu) ?? [])).toHaveLength(1);
    expect(tiledocSource).not.toContain("StudioVelloHubSurface");
    expect(tiledocSource).not.toContain("StudioRasterCrdtCanvas");
    expect(tiledocSource).not.toContain("canvas2d");
    expect(tiledocSource).not.toContain("fallback");
    expect(tiledocSource).toContain('STUDIO_TILEDOC_PRODUCT_RASTER_LAYER_ID');
  });
});
