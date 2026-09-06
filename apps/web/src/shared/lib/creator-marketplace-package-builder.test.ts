import { describe, expect, it } from "vitest";

import { createCreatorMarketplaceDraftFromBrushStudio } from "./creator-marketplace-authoring-workshop";
import {
  buildCreatorMarketplaceSourcePackage,
  CreatorMarketplacePackageError,
  extractCreatorMarketplaceManifestFromZip,
  sanitizeCreatorMarketplaceArchivePath,
} from "./creator-marketplace-package-builder";

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTruthy();
  expect(typeof value).toBe("object");
  return value as Record<string, unknown>;
}

describe("creator marketplace source package", () => {
  it("packages native Brush Studio programs, draft and source files into a recoverable ZIP", async () => {
    const draft = createCreatorMarketplaceDraftFromBrushStudio({
      name: "Graphite and wash",
      seed: 8842,
      enginePrograms: [
        { id: "graphite", kind: "dry-media", grain: { scale: 0.72 } },
        { id: "wash", kind: "watercolor-diffusion", wetMix: { water: 0.6 } },
      ],
    });
    const source = new File(
      [JSON.stringify({ native: true, enginePrograms: draft.brush.originalEnginePrograms })],
      "graphite.brush.json",
      { type: "application/json" },
    );

    const built = await buildCreatorMarketplaceSourcePackage({ draft, sourceFiles: [source] });
    const parsed = asRecord(extractCreatorMarketplaceManifestFromZip(await built.file.arrayBuffer()));
    const brush = asRecord(parsed.brush);
    const packageInfo = asRecord(parsed.package);
    const inventory = packageInfo.inventory as readonly Record<string, unknown>[];

    expect(built.file.name).toMatch(/Graphite-and-wash-1\.0\.0\.toonmarket\.zip$/u);
    expect(brush.enginePrograms).toEqual(draft.brush.originalEnginePrograms);
    expect(inventory.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["authoring/draft.json", "source/graphite.brush.json"]),
    );
    expect(built.inventory.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["manifest.json", "authoring/draft.json", "source/graphite.brush.json"]),
    );
    expect(built.inventory.every((entry) => /^[0-9a-f]{64}$/u.test(entry.sha256))).toBe(true);
  });

  it("deduplicates source names without overwriting either file", async () => {
    const draft = createCreatorMarketplaceDraftFromBrushStudio({ name: "Duplicate sources" });
    const built = await buildCreatorMarketplaceSourcePackage({
      draft,
      sourceFiles: [
        new File(["one"], "tip.png", { type: "image/png" }),
        new File(["two"], "tip.png", { type: "image/png" }),
      ],
    });
    expect(built.inventory.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["source/tip.png", "source/tip-2.png"]),
    );
  });

  it("rejects path traversal in package entry names", () => {
    expect(() => sanitizeCreatorMarketplaceArchivePath("../secret.txt")).toThrow(
      CreatorMarketplacePackageError,
    );
  });

  it("rejects archives without a central directory", () => {
    expect(() => extractCreatorMarketplaceManifestFromZip(new Uint8Array([1, 2, 3, 4]))).toThrow(
      CreatorMarketplacePackageError,
    );
  });
});
