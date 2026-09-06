import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPageSource = readStudioPageCompositionSource();
const rasterExportSource = readFileSync(
  new URL("./render/studio-raster-export-orchestration-runtime.ts", import.meta.url),
  "utf8",
);
const projectArchiveSource = readFileSync(
  new URL("./studio-project-archive-orchestration-runtime.ts", import.meta.url),
  "utf8",
);
const rasterExportLoaderSource = readFileSync(
  new URL("./useStudioRasterExportOrchestration.ts", import.meta.url),
  "utf8",
);
const projectArchiveLoaderSource = readFileSync(
  new URL("./useStudioProjectArchiveOrchestration.ts", import.meta.url),
  "utf8",
);
const sharedRuntimeSource = readFileSync(
  new URL("./studio-page-orchestration-runtime.ts", import.meta.url),
  "utf8",
);

describe("StudioPage user-action orchestration boundary", () => {
  it("keeps expensive export and archive work behind explicit orchestration seams", () => {
    // StudioPage is currently the integration shell for the renderer migration. Do not make
    // engine-quality work fail because the coordinator crossed an arbitrary source-byte limit;
    // preserve the meaningful boundary instead: rare export/archive codecs stay extracted and
    // lazy while the live canvas authority is replaced incrementally.
    expect(studioPageSource).toContain(
      'import { useStudioRasterExportOrchestration } from "./useStudioRasterExportOrchestration";',
    );
    expect(studioPageSource).toContain(
      'import { useStudioProjectArchiveOrchestration } from "./useStudioProjectArchiveOrchestration";',
    );
  });

  it("does not inline the extracted rare handlers back into StudioPage", () => {
    expect(studioPageSource).not.toContain("async function handleDownload(");
    expect(studioPageSource).not.toContain(
      "async function exportCurrentPageToRasterInterchange(",
    );
    expect(studioPageSource).not.toContain("async function handleDownloadAll(");
    expect(studioPageSource).not.toContain("async function handleExportProject(");
    expect(studioPageSource).not.toContain(
      "async function handleExportProjectArchive(",
    );
    expect(studioPageSource).toContain(
      "return rasterExportOrchestration.handleCopyToClipboard();",
    );
    expect(studioPageSource).toContain(
      "return projectArchiveOrchestration.handleImportProject(event);",
    );
  });

  it("keeps heavy export and archive codecs behind analyzable action boundaries", () => {
    expect(rasterExportSource).toContain('await import("../export/studio-export")');
    expect(rasterExportSource).toContain(
      '"./studio-raster-interchange-worker-client"',
    );
    expect(projectArchiveSource).toContain('import("./studio-project-archive")');
    expect(projectArchiveSource).toMatch(
      /import\(\s*["']\.\/vrm\/studio-vrm-texture-paint-project-library["']\)/,
    );
    expect(studioPageSource).toContain(
      'await import("./render/studio-raster-asset-client")',
    );
    expect(studioPageSource).toContain(
      "filterMaskSurfaceArchiveDependencies,",
    );
    expect(studioPageSource).not.toMatch(
      /import\s+[^;]*from\s+["']\.\/studio-raster-asset-client["']/u,
    );
    expect(projectArchiveSource).not.toMatch(
      /import\s+[^;]*from\s+["']\.\/studio-project-archive["']/u,
    );
    expect(projectArchiveSource).not.toMatch(
      /import\s+[^;]*from\s+["']\.\/studio-vrm-texture-paint-project-library["']/u,
    );
    expect(projectArchiveSource).not.toMatch(
      /import\s+\{\s*loadStudioReleaseScheduleRuntime\s*\}\s+from\s+["']\.\/studio-release-schedule-loader["']/u,
    );
    expect(projectArchiveSource).not.toMatch(
      /import\s+\{\s*normalizeStudioPublicationAnalyticsDeferred\s*\}\s+from\s+["']\.\/studio-publication-analytics-loader["']/u,
    );
    expect(studioPageSource).toContain(
      "loadStudioReleaseScheduleRuntime,",
    );
    expect(studioPageSource).toContain(
      "normalizeStudioPublicationAnalyticsDeferred,",
    );
    expect(studioPageSource).toContain(
      "requestStudioVrmProjectArchiveUseContext,",
    );
    expect(rasterExportLoaderSource).toContain(
      'import("./studio-page-orchestration-runtime")',
    );
    expect(projectArchiveLoaderSource).toContain(
      'import("./studio-page-orchestration-runtime")',
    );
    expect(sharedRuntimeSource).toContain(
      'from "./render/studio-raster-export-orchestration-runtime"',
    );
    expect(sharedRuntimeSource).toContain(
      'from "./studio-project-archive-orchestration-runtime"',
    );
    expect(rasterExportLoaderSource).not.toContain(
      "loadChunkWithReloadRecovery",
    );
    expect(projectArchiveLoaderSource).not.toContain(
      "loadChunkWithReloadRecovery",
    );
  });

  it("captures the import mutation fence before crossing the lazy runtime boundary", () => {
    const importStart = projectArchiveLoaderSource.indexOf(
      "handleImportProject: async (event) =>",
    );
    const archiveImportStart = projectArchiveLoaderSource.indexOf(
      "handleImportProjectArchive: async (event) =>",
    );
    const importSource = projectArchiveLoaderSource.slice(
      importStart,
      archiveImportStart,
    );
    const archiveImportSource = projectArchiveLoaderSource.slice(
      archiveImportStart,
    );
    for (const source of [importSource, archiveImportSource]) {
      const fileCapture = source.indexOf(
        "const file = event.currentTarget.files?.[0] ?? null;",
      );
      const mutationFence = source.indexOf(
        "const mutationTicket = input.captureStudioMutationTicket();",
      );
      const lazyBoundary = source.indexOf("await load()");
      const promiseLazyBoundary = source.indexOf("void load()");
      expect(fileCapture).toBeGreaterThanOrEqual(0);
      expect(mutationFence).toBeGreaterThan(fileCapture);
      expect(Math.max(lazyBoundary, promiseLazyBoundary)).toBeGreaterThan(
        mutationFence,
      );
    }
  });

  it("keeps each compiler-owned orchestration module far below Babel's deopt size", () => {
    expect(Buffer.byteLength(rasterExportSource, "utf8")).toBeLessThan(50_000);
    expect(Buffer.byteLength(projectArchiveSource, "utf8")).toBeLessThan(50_000);
    expect(Buffer.byteLength(rasterExportLoaderSource, "utf8")).toBeLessThan(8_000);
    expect(Buffer.byteLength(projectArchiveLoaderSource, "utf8")).toBeLessThan(8_000);
    expect(Buffer.byteLength(sharedRuntimeSource, "utf8")).toBeLessThan(5_000);
  });
});
