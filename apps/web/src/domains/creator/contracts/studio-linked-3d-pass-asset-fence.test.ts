import { describe, expect, it } from "vitest";

import {
  assertStudioLinked3dPassAssetRows,
  extractStudioLinked3dPassAssetRequirements,
  isStudioLinked3dPassServerAssetId,
  StudioLinked3dPassAssetFenceError,
  type CreatorWorkLinked3dJsonEnvelope,
  type StudioLinked3dPassAssetRow,
} from "./studio-linked-3d-pass-asset-fence";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const LOCATOR_A = `studio-opfs-cas:sha256:${HASH_A}`;

function linkedEnvelope(): CreatorWorkLinked3dJsonEnvelope {
  const artifact = {
    pass: "line",
    role: "main-line",
    contentHash: `sha256:${HASH_A}`,
    byteSize: 68,
    mime: "image/png",
    width: 64,
    height: 32,
    locator: LOCATOR_A,
  };
  return {
    cover: "data:image/png;base64,cover",
    pages: ["data:image/png;base64,page"],
    doc: {
      pagesList: [{
        id: "page-1",
        elements: [{ id: "line-1", type: "image", src: LOCATOR_A }],
        linked3dRender: {
          kind: "toonspectrum.studio-linked-3d-render",
          version: 2,
          authority: "studio-project-linked-3d-pass-index",
          links: [{
            bundleId: "bundle-1",
            shotId: "shot-1",
            sourceShotId: null,
            stageSourceHash: `sha256:${HASH_B}`,
            layers: [{ elementId: "line-1", role: "main-line" }],
            passRevision: {
              revision: 1,
              sourceHash: `sha256:${HASH_B}`,
              sceneHash: `sha256:${HASH_B}`,
              cameraHash: `sha256:${HASH_B}`,
              baseGeometryHash: `sha256:${HASH_B}`,
              topologyHash: `sha256:${HASH_B}`,
              objectIdentityHash: `sha256:${HASH_B}`,
              objectStableIds: ["obj/room"],
              passRootHash: `sha256:${HASH_B}`,
              artifact,
            },
            corrections: [],
          }],
        },
      }],
    },
  };
}

function linkedEnvelopeWithLinkCount(count: number): CreatorWorkLinked3dJsonEnvelope {
  const envelope = linkedEnvelope();
  const page = (envelope.doc as {
    pagesList: Array<{
      elements: Array<Record<string, unknown>>;
      linked3dRender: { links: Array<Record<string, unknown>> };
    }>;
  }).pagesList[0]!;
  const baseLink = page.linked3dRender.links[0]!;
  page.elements = Array.from({ length: count }, (_, index) => ({
    id: `line-${index}`,
    type: "image",
    src: LOCATOR_A,
  }));
  page.linked3dRender.links = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(baseLink),
    bundleId: `bundle-${index}`,
    shotId: `shot-${index}`,
    layers: [{ elementId: `line-${index}`, role: "main-line" }],
  }));
  return envelope;
}

function assetRow(
  patch: Partial<StudioLinked3dPassAssetRow> = {},
): StudioLinked3dPassAssetRow {
  const assetId = `linked3d-pass-sha256-${HASH_A}`;
  return {
    workId: "work-1",
    assetId,
    elementType: "image",
    mimeType: "image/png",
    descriptor: {
      version: 1,
      element: {
        id: assetId,
        type: "image",
        x: 0,
        y: 0,
        width: 64,
        height: 32,
        rotation: 0,
      },
    },
    byteSize: 68,
    sha256: HASH_A,
    intrinsicWidth: 64,
    intrinsicHeight: 32,
    decodedRgbaBytes: 64 * 32 * 4,
    ...patch,
  };
}

function expectFenceCode(run: () => unknown, code: StudioLinked3dPassAssetFenceError["code"]): void {
  try {
    run();
    throw new Error("expected linked 3D asset fence failure");
  } catch (error) {
    expect(error).toBeInstanceOf(StudioLinked3dPassAssetFenceError);
    expect((error as StudioLinked3dPassAssetFenceError).code).toBe(code);
  }
}

describe("linked 3D pass server asset fence", () => {
  it("reserves only exact deterministic cloud asset IDs from generic upload GC", () => {
    expect(isStudioLinked3dPassServerAssetId(`linked3d-pass-sha256-${HASH_A}`)).toBe(true);
    expect(isStudioLinked3dPassServerAssetId(`linked3d-pass-sha256-${HASH_A.toUpperCase()}`))
      .toBe(false);
    expect(isStudioLinked3dPassServerAssetId(`linked3d-pass-sha256-${HASH_A}0`)).toBe(false);
    expect(isStudioLinked3dPassServerAssetId("image-layer-1")).toBe(false);
  });

  it("extracts one deterministic immutable asset from the exact element/receipt pair", () => {
    const requirements = extractStudioLinked3dPassAssetRequirements(linkedEnvelope());

    expect(requirements).toEqual([{
      assetId: `linked3d-pass-sha256-${HASH_A}`,
      contentHash: `sha256:${HASH_A}`,
      rawSha256: HASH_A,
      locator: LOCATOR_A,
      byteSize: 68,
      width: 64,
      height: 32,
      decodedRgbaBytes: 64 * 32 * 4,
    }]);
  });

  it("accepts 65 exact links under the per-page byte budget without a product-total cap", () => {
    const requirements = extractStudioLinked3dPassAssetRequirements(
      linkedEnvelopeWithLinkCount(65),
    );

    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.assetId).toBe(`linked3d-pass-sha256-${HASH_A}`);
  });

  it("rejects a linked index that exceeds the per-page serialized byte budget", () => {
    expectFenceCode(
      () => extractStudioLinked3dPassAssetRequirements(linkedEnvelopeWithLinkCount(512)),
      "receipt-mismatch",
    );
  });

  it("allows legacy creator JSON without the reserved namespace", () => {
    expect(extractStudioLinked3dPassAssetRequirements({
      cover: "",
      pages: [],
      doc: { pagesList: [{ linked3dRender: { legacy: true } }] },
    })).toEqual([]);
  });

  it.each([
    ["malformed main-line locator", "receipt-mismatch", (value: CreatorWorkLinked3dJsonEnvelope) => {
      const doc = value.doc as { pagesList: Array<{ elements: Array<{ src: string }> }> };
      doc.pagesList[0]!.elements[0]!.src = "studio-opfs-cas:sha256:not-a-hash";
    }],
    ["reserved locator in a mask", "invalid-reserved-locator", (value: CreatorWorkLinked3dJsonEnvelope) => {
      const doc = value.doc as { pagesList: Array<{ elements: Array<Record<string, unknown>> }> };
      doc.pagesList[0]!.elements[0]!.maskSrc = LOCATOR_A;
    }],
    ["reserved locator in rendered pages", "invalid-reserved-locator", (value: CreatorWorkLinked3dJsonEnvelope) => {
      (value.pages as string[])[0] = LOCATOR_A;
    }],
    ["unpaired main-line source", "invalid-reserved-locator", (value: CreatorWorkLinked3dJsonEnvelope) => {
      const doc = value.doc as { pagesList: Array<Record<string, unknown>> };
      delete doc.pagesList[0]!.linked3dRender;
    }],
  ] as const)("rejects %s", (_name, code, mutate) => {
    const value = linkedEnvelope();
    mutate(value);
    expectFenceCode(
      () => extractStudioLinked3dPassAssetRequirements(value),
      code,
    );
  });

  it("rejects a receipt whose main-line element does not own the locator", () => {
    const value = linkedEnvelope();
    const doc = value.doc as {
      pagesList: Array<{ linked3dRender: { links: Array<{ layers: unknown[] }> } }>;
    };
    doc.pagesList[0]!.linked3dRender.links[0]!.layers = [
      { elementId: "missing-line", role: "main-line" },
    ];

    expectFenceCode(
      () => extractStudioLinked3dPassAssetRequirements(value),
      "receipt-mismatch",
    );
  });

  it("deduplicates identical PNG requirements but rejects conflicting same-hash receipts", () => {
    const value = linkedEnvelope();
    const doc = value.doc as { pagesList: unknown[] };
    doc.pagesList.push(structuredClone(doc.pagesList[0]));
    const second = doc.pagesList[1] as {
      elements: Array<{ id: string }>;
      linked3dRender: { links: Array<{ layers: Array<{ elementId: string }> }> };
    };
    second.elements[0]!.id = "line-2";
    second.linked3dRender.links[0]!.layers[0]!.elementId = "line-2";
    expect(extractStudioLinked3dPassAssetRequirements(value)).toHaveLength(1);

    const artifact = (second.linked3dRender.links[0] as unknown as {
      passRevision: { artifact: { width: number } };
    }).passRevision.artifact;
    artifact.width = 32;
    expectFenceCode(
      () => extractStudioLinked3dPassAssetRequirements(value),
      "receipt-mismatch",
    );
  });

  it("accepts only the exact same-work PNG metadata and deterministic descriptor", () => {
    const requirements = extractStudioLinked3dPassAssetRequirements(linkedEnvelope());
    expect(() => assertStudioLinked3dPassAssetRows({
      workId: "work-1",
      requirements,
      rows: [assetRow()],
    })).not.toThrow();
  });

  it("rejects a missing immutable row", () => {
    const requirements = extractStudioLinked3dPassAssetRequirements(linkedEnvelope());
    expectFenceCode(() => assertStudioLinked3dPassAssetRows({
      workId: "work-1",
      requirements,
      rows: [],
    }), "asset-missing");
  });

  it.each([
    ["other work", { workId: "work-2" }],
    ["non-PNG", { mimeType: "image/webp" }],
    ["wrong byte size", { byteSize: 67 }],
    ["wrong hash", { sha256: HASH_B }],
    ["wrong intrinsic width", { intrinsicWidth: 63 }],
    ["wrong intrinsic height", { intrinsicHeight: 31 }],
    ["wrong decoded RGBA", { decodedRgbaBytes: 1 }],
  ])("rejects asset metadata from %s", (_name, patch) => {
    const requirements = extractStudioLinked3dPassAssetRequirements(linkedEnvelope());
    expectFenceCode(() => assertStudioLinked3dPassAssetRows({
      workId: "work-1",
      requirements,
      rows: [assetRow(patch)],
    }), "asset-mismatch");
  });

  it("rejects a widened descriptor even when every manifest scalar matches", () => {
    const requirements = extractStudioLinked3dPassAssetRequirements(linkedEnvelope());
    const row = assetRow();
    const descriptor = structuredClone(row.descriptor) as {
      element: Record<string, unknown>;
    };
    descriptor.element.opacity = 1;
    expectFenceCode(() => assertStudioLinked3dPassAssetRows({
      workId: "work-1",
      requirements,
      rows: [{ ...row, descriptor }],
    }), "asset-mismatch");
  });
});
