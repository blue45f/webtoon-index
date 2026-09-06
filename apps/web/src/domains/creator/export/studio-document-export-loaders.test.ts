import { describe, expect, it } from "vitest";

import {
  loadStudioPsdExportModule,
  loadStudioPsdImportModule,
  loadStudioSvgExportModule,
} from "./studio-document-export-loaders";

describe("studio document export loaders", () => {
  it("coalesces concurrent SVG engine requests into one analyzable module promise", async () => {
    const first = loadStudioSvgExportModule();
    const second = loadStudioSvgExportModule();

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({
      SVG_EXPORT_MIME: "image/svg+xml;charset=utf-8",
      exportPageToSvg: expect.any(Function),
      svgExportFileName: expect.any(Function),
    });
  });

  it("coalesces concurrent PSD export engine requests", async () => {
    const first = loadStudioPsdExportModule();
    const second = loadStudioPsdExportModule();

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({
      exportPagePsd: expect.any(Function),
      psdExportFileName: expect.any(Function),
    });
  });

  it("coalesces concurrent PSD import engine requests independently from export", async () => {
    const first = loadStudioPsdImportModule();
    const second = loadStudioPsdImportModule();

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({
      importPsdFile: expect.any(Function),
      psdImportResultMessage: expect.any(Function),
    });
  });
});
