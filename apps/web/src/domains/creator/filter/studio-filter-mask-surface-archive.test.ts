import { describe, expect, it, vi } from "vitest";

import {
  buildStudioProjectArchive as buildStudioProjectArchiveWithBackend,
  importStudioProjectArchive,
} from "../studio-project-archive";

import {
  hasStudioFilterMaskSurfaceArchiveReferences,
  prepareStudioFilterMaskSurfaceArchiveExport,
  StudioFilterMaskSurfaceArchiveError,
  type StudioFilterMaskSurfaceArchiveDependencies,
} from "./studio-filter-mask-surface-archive";

import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  type StudioRasterOperationLog,
} from "@/shared/lib/studio-crdt-raster-ops";
import {
  createStudioFilterMaskSurfaceSpec,
  type StudioFilterMaskSurfaceId,
} from "@/shared/lib/studio-filter-mask-surface-contract";

function buildStudioProjectArchive(
  input: Parameters<typeof buildStudioProjectArchiveWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioProjectArchiveWithBackend>[1]> = {},
): ReturnType<typeof buildStudioProjectArchiveWithBackend> {
  return buildStudioProjectArchiveWithBackend(input, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

const SURFACE_ID =
  "filter-mask:v1:00000000-0000-4000-8000-000000000001" as StudioFilterMaskSurfaceId;
const OPERATION_ID = "00000000-0000-4000-8000-000000000002";
const PNG_BYTES = Uint8Array.from(
  globalThis.atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X1D0WQAAAABJRU5ErkJggg=="
  ),
  (character) => character.charCodeAt(0)
);
const PNG_DATA_URL = `data:image/png;base64,${globalThis.btoa(
  String.fromCharCode(...PNG_BYTES)
)}`;

function projectWithSurface(
  overrides: Record<string, unknown> = {},
  includeMaster = false
) {
  const element = {
    id: "image-1",
    type: "image",
    src: "builtin:raster",
    filterMaskSurfaceId: SURFACE_ID,
    filterMaskEnabled: false,
    ...overrides,
  };
  return {
    version: 2,
    title: "portable mask",
    description: "",
    tagsText: "",
    pagesList: [{
      id: "page-1",
      elements: [element],
      bg: "#fff",
      bgGrad: null,
      canvasH: 1_080,
    }],
    currentPageId: "page-1",
    webtoonTheme: "classic",
    panelGutter: 24,
    ...(includeMaster
      ? {
          master: {
            elements: [{
              ...element,
              id: "master-image",
              filterMaskSrc: "blob:https://studio.test/stale-mask",
            }],
          },
        }
      : {}),
  };
}

function rasterLog(surfaceId = SURFACE_ID): StudioRasterOperationLog {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: createStudioFilterMaskSurfaceSpec({
      surfaceId,
      width: 1,
      height: 1,
    }),
    operations: [{
      version: STUDIO_RASTER_CRDT_VERSION,
      operationId: OPERATION_ID,
      order: { logicalClock: "1", actorId: "artist-1" },
      pageId: "page-1",
      layerId: "image-1",
      intent: "paint",
      kernel: STUDIO_RASTER_KERNEL,
      semanticParametersSha256: "b".repeat(64),
      patches: [{
        tileX: 0,
        tileY: 0,
        region: { x: 0, y: 0, width: 1, height: 1 },
        effect: {
          kind: "composite",
          blendMode: "source-over",
          payload: {
            scope: "work",
            assetId: "mask-png-1",
            sha256: "a".repeat(64),
            byteLength: PNG_BYTES.byteLength,
            mediaType: "image/png",
            width: 1,
            height: 1,
          },
        },
      }],
    }],
    undoOperations: [],
    undoAcknowledgements: [],
  };
}

function dependencies(
  overrides: Partial<StudioFilterMaskSurfaceArchiveDependencies> = {}
) {
  const getRasterOperationLogAsync = vi.fn(async () => rasterLog());
  const replay = vi.fn(async (request: Parameters<
    NonNullable<StudioFilterMaskSurfaceArchiveDependencies["replay"]>
  >[0]) => ({
    workId: request.workId,
    surface: request.log.surface,
    checkpointId: null,
    tiles: [],
    appliedOperationIds: [OPERATION_ID],
    undoneOperationIds: [],
    conflictedOperationIds: [],
    appliedPatchCount: 1,
  }));
  const materializePng = vi.fn(async () => (
    new Blob([PNG_BYTES], { type: "image/png" })
  ));
  const value = {
    document: { getRasterOperationLogAsync },
    download: vi.fn(async () => PNG_BYTES),
    replay,
    materializePng,
    ...overrides,
  } satisfies StudioFilterMaskSurfaceArchiveDependencies;
  return { value, getRasterOperationLogAsync, replay, materializePng };
}

function request(project: unknown, overrides: Record<string, unknown> = {}) {
  return {
    project,
    workId: "work-1",
    generation: 7,
    isCurrent: vi.fn(async () => true),
    ...overrides,
  };
}

describe("studio filter-mask surface archive", () => {
  it("keeps an invalidated inline edit portable without reading the stale durable surface", async () => {
    const source = projectWithSurface({
      filterMaskSrc: PNG_DATA_URL,
      filterMaskEnabled: true,
    });
    const edited = source.pagesList[0]!.elements[0] as Record<string, unknown>;
    delete edited.filterMaskSurfaceId;
    const setup = dependencies();

    expect(hasStudioFilterMaskSurfaceArchiveReferences(source)).toBe(false);
    const prepared = await prepareStudioFilterMaskSurfaceArchiveExport(
      request(source),
      setup.value
    );

    expect(prepared).toMatchObject({
      surfaceCount: 0,
      referenceCount: 0,
      materializedPngBytes: 0,
    });
    expect(setup.getRasterOperationLogAsync).not.toHaveBeenCalled();
    expect(setup.replay).not.toHaveBeenCalled();
    expect(setup.materializePng).not.toHaveBeenCalled();
    expect(prepared.project.pagesList[0]!.elements[0]).toMatchObject({
      filterMaskSrc: PNG_DATA_URL,
      filterMaskEnabled: true,
    });
    expect(prepared.project.pagesList[0]!.elements[0]).not.toHaveProperty(
      "filterMaskSurfaceId"
    );
  });

  it("dedupes a work surface, creates inline fallbacks, and lets the existing archive own mask paths", async () => {
    const source = projectWithSurface({}, true);
    const setup = dependencies();

    const prepared = await prepareStudioFilterMaskSurfaceArchiveExport(
      request(source),
      setup.value
    );

    expect(prepared).toMatchObject({
      surfaceCount: 1,
      referenceCount: 2,
      materializedPngBytes: PNG_BYTES.byteLength,
    });
    expect(setup.getRasterOperationLogAsync).toHaveBeenCalledOnce();
    expect(setup.replay).toHaveBeenCalledOnce();
    expect(setup.materializePng).toHaveBeenCalledOnce();
    expect(JSON.stringify(prepared.project)).not.toContain("filterMaskSurfaceId");
    expect(JSON.stringify(prepared.project)).not.toContain("blob:");
    const pageElement = prepared.project.pagesList[0]!.elements[0] as Record<string, unknown>;
    const masterElement = (
      prepared.project.master as { elements: Record<string, unknown>[] }
    ).elements[0]!;
    expect(pageElement).toMatchObject({
      filterMaskSrc: PNG_DATA_URL,
      filterMaskEnabled: false,
    });
    expect(masterElement).toMatchObject({
      filterMaskSrc: PNG_DATA_URL,
      filterMaskEnabled: false,
    });
    expect(
      (source.pagesList[0]!.elements[0] as Record<string, unknown>).filterMaskSurfaceId
    ).toBe(SURFACE_ID);
    expect(
      ((source.master as { elements: Record<string, unknown>[] }).elements[0]!).filterMaskSrc
    ).toBe("blob:https://studio.test/stale-mask");

    const archive = await buildStudioProjectArchive({ project: prepared.project });
    expect(archive.manifest.attachments).toHaveLength(1);
    expect(archive.manifest.attachments[0]).toMatchObject({
      mimeType: "image/png",
      kinds: ["mask"],
    });
    expect(archive.manifest.attachments[0]!.path).toMatch(
      /^assets\/sha256\/[a-f0-9]{64}\.png$/u
    );
    expect(archive.manifest.attachments[0]!.documentReferences).toEqual([
      {
        pointer: "/master/elements/0/filterMaskSrc",
        usage: "mask",
        mode: "asset-uri",
      },
      {
        pointer: "/pagesList/0/elements/0/filterMaskSrc",
        usage: "mask",
        mode: "asset-uri",
      },
    ]);
    expect(archive.canonicalProjectJson).not.toContain("data:image");
    expect(archive.canonicalProjectJson).not.toContain("filter-mask:v1:");
    expect(archive.canonicalProjectJson).not.toContain("blob:");

    const imported = await importStudioProjectArchive(archive.blob);
    expect(
      (imported.project.pagesList[0]!.elements[0] as Record<string, unknown>).filterMaskSrc
    ).toBe(PNG_DATA_URL);
    expect(JSON.stringify(imported.project)).not.toContain("filterMaskSurfaceId");
  });

  it("checks the generation after materialization and never returns a stale partial snapshot", async () => {
    const source = projectWithSurface();
    const setup = dependencies();
    const isCurrent = vi.fn(async ({ phase }: { phase: string }) => phase !== "before-return");

    await expect(
      prepareStudioFilterMaskSurfaceArchiveExport(
        request(source, { isCurrent }),
        setup.value
      )
    ).rejects.toMatchObject({
      name: "StudioFilterMaskSurfaceArchiveError",
      code: "stale",
    });
    expect(setup.materializePng).toHaveBeenCalledOnce();
    expect(JSON.stringify(source)).toContain(SURFACE_ID);
    expect(JSON.stringify(source)).not.toContain(PNG_DATA_URL);
  });

  it("fails closed when the CRDT log is missing or belongs to another surface", async () => {
    const missing = dependencies({
      document: { getRasterOperationLogAsync: vi.fn(async () => null) },
    });
    await expect(
      prepareStudioFilterMaskSurfaceArchiveExport(
        request(projectWithSurface()),
        missing.value
      )
    ).rejects.toMatchObject({
      name: "StudioFilterMaskSurfaceArchiveError",
      code: "missing_surface",
    });

    const wrongSurface =
      "filter-mask:v1:00000000-0000-4000-8000-000000000009" as StudioFilterMaskSurfaceId;
    const mismatched = dependencies({
      document: {
        getRasterOperationLogAsync: vi.fn(async () => rasterLog(wrongSurface)),
      },
    });
    await expect(
      prepareStudioFilterMaskSurfaceArchiveExport(
        request(projectWithSurface()),
        mismatched.value
      )
    ).rejects.toMatchObject({
      name: "StudioFilterMaskSurfaceArchiveError",
      code: "surface_invalid",
    });
  });

  it("rejects malformed references and any Blob URL that would survive into project.json", async () => {
    const setup = dependencies();
    await expect(
      prepareStudioFilterMaskSurfaceArchiveExport(
        request(projectWithSurface({ filterMaskSurfaceId: "mask:unsafe" })),
        setup.value
      )
    ).rejects.toMatchObject({
      name: "StudioFilterMaskSurfaceArchiveError",
      code: "invalid_reference",
    });

    await expect(
      prepareStudioFilterMaskSurfaceArchiveExport(
        request(projectWithSurface({ previewSrc: "blob:https://studio.test/ephemeral" })),
        setup.value
      )
    ).rejects.toMatchObject({
      name: "StudioFilterMaskSurfaceArchiveError",
      code: "non_portable",
    });
  });

  it("propagates cancellation to the external document boundary as an aborted export", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const setup = dependencies();

    await expect(
      prepareStudioFilterMaskSurfaceArchiveExport(
        request(projectWithSurface(), { signal: controller.signal }),
        setup.value
      )
    ).rejects.toMatchObject({
      name: "StudioFilterMaskSurfaceArchiveError",
      code: "aborted",
    });
    expect(setup.getRasterOperationLogAsync).not.toHaveBeenCalled();
  });

  it("exposes typed failures for callers that need a fail-closed archive status", () => {
    const error = new StudioFilterMaskSurfaceArchiveError("stale", "stale");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("stale");
  });
});
