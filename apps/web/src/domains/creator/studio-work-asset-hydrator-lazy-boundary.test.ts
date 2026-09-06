import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";


const facadeSource = readFileSync(
  new URL("./studio-work-asset-hydrator.ts", import.meta.url),
  "utf8"
);
const runtimeSource = readFileSync(
  new URL("./studio-work-asset-hydrator-runtime.ts", import.meta.url),
  "utf8"
);
const studioPageSource = readStudioPageCompositionSource();
const viteConfigSource = readFileSync(new URL("../../../vite.config.ts", import.meta.url), "utf8");

describe("Studio work-asset hydrator lazy boundary", () => {
  it("keeps the synchronous façade free of the request client value graph", () => {
    expect(facadeSource).toContain('import("./studio-work-asset-hydrator-runtime")');
    expect(facadeSource).not.toContain("downloadStudioWorkAsset");
    expect(facadeSource).not.toContain("StudioWorkAssetRequestError");
    expect(runtimeSource).toContain("downloadStudioWorkAsset");
    expect(runtimeSource).toContain("StudioWorkAssetRequestError");
    expect(runtimeSource).toContain('from "./studio-work-asset-client"');
  });

  it("preserves StudioPage's stable constructor and useSyncExternalStore contract", () => {
    expect(studioPageSource).toMatch(
      /import \{ StudioWorkAssetHydrator \} from ["'][^"']*studio-work-asset-hydrator["']/u
    );
    expect(studioPageSource).toContain("() => new StudioWorkAssetHydrator(null)");
    expect(studioPageSource).toMatch(
      /useSyncExternalStore\(\s*studioWorkAssetHydrator\.subscribe,\s*studioWorkAssetHydrator\.getVersion,\s*studioWorkAssetHydrator\.getVersion,?\s*\)/u
    );
  });

  it("co-locates only dependency-free linked surface contracts in the existing micro chunk", () => {
    expect(viteConfigSource).toContain("/studio-element-model.ts");
    expect(viteConfigSource).toContain("/studio-raster-image-presentation.ts");
    expect(viteConfigSource).toContain('return "studio-core-micro-contracts";');
    expect(viteConfigSource).not.toContain('return "studio-linked-3d-contract";');
  });
});
