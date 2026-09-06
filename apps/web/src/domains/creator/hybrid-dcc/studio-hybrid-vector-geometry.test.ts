import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  renderStudioHybridVectorGeometry,
  STUDIO_HYBRID_VECTOR_CAPABILITY_RECEIPT,
  STUDIO_HYBRID_VECTOR_CONTRACT_VERSION,
  type StudioHybridVectorArtifact,
  type StudioHybridVectorPoint,
  type StudioHybridVectorRequest,
  type StudioHybridVectorRing,
  type StudioHybridVectorSample,
  type StudioHybridVectorStyle,
} from "./studio-hybrid-vector-geometry";

function request(
  points: readonly StudioHybridVectorSample[],
  style: StudioHybridVectorStyle,
  id = "stroke-a"
): StudioHybridVectorRequest {
  return {
    contractVersion: STUDIO_HYBRID_VECTOR_CONTRACT_VERSION,
    strokes: [{ id, points }],
    style,
    precision: 4,
  };
}

function artifact(
  result: Awaited<ReturnType<typeof renderStudioHybridVectorGeometry>>
): StudioHybridVectorArtifact {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.artifact;
}

function horizontalSamples(pressure: number): StudioHybridVectorSample[] {
  return Array.from({ length: 21 }, (_, index) => ({
    x: index * 5,
    y: 50,
    pressure,
  }));
}

function ringArea(ring: StudioHybridVectorRing): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function orientation(a: StudioHybridVectorPoint, b: StudioHybridVectorPoint, c: StudioHybridVectorPoint) {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

function strictSegmentsCross(
  a: StudioHybridVectorPoint,
  b: StudioHybridVectorPoint,
  c: StudioHybridVectorPoint,
  d: StudioHybridVectorPoint
): boolean {
  return orientation(a, b, c) * orientation(a, b, d) < 0
    && orientation(c, d, a) * orientation(c, d, b) < 0;
}

function hasStrictSelfIntersection(ring: StudioHybridVectorRing): boolean {
  for (let first = 0; first < ring.length; first += 1) {
    const firstNext = (first + 1) % ring.length;
    for (let second = first + 1; second < ring.length; second += 1) {
      const secondNext = (second + 1) % ring.length;
      if (
        first === second
        || firstNext === second
        || secondNext === first
        || (first === 0 && secondNext === 0)
      ) {
        continue;
      }
      if (strictSegmentsCross(
        ring[first]!,
        ring[firstNext]!,
        ring[second]!,
        ring[secondNext]!
      )) return true;
    }
  }
  return false;
}

describe("studio hybrid vector geometry — pressure outline quality corpus", () => {
  it("builds one canonical, deterministic curved pressure silhouette", async () => {
    const points = Array.from({ length: 33 }, (_, index) => {
      const t = index / 32;
      return {
        x: t * 160,
        y: 80 + Math.sin(t * Math.PI * 1.6) * 42,
        pressure: 0.2 + t * 0.7,
      };
    });
    const input = request(points, {
      mode: "ink",
      size: 14,
      thinning: 0.8,
      smoothing: 0.7,
      streamline: 0.12,
      simulatePressure: false,
      topology: "repair-self-intersections",
    });
    const first = artifact(await renderStudioHybridVectorGeometry(input));
    const second = artifact(await renderStudioHybridVectorGeometry(input));

    expect(second).toEqual(first);
    expect(first.polygons.length).toBeGreaterThan(0);
    expect(first.vertexCount).toBeGreaterThan(20);
    expect(first.polygons.every((polygon) => ringArea(polygon[0]!) > 0)).toBe(true);
    expect(first.bounds.width).toBeGreaterThan(140);
    expect(first.receipt.usedCapabilities).toEqual(["pressure-outline", "robust-topology"]);
  });

  it("preserves a visible tap instead of dropping a one-sample stroke", async () => {
    const tap = artifact(await renderStudioHybridVectorGeometry(request(
      [{ x: 30, y: 40, pressure: 0.65 }],
      {
        mode: "ink",
        size: 18,
        thinning: 0.75,
        simulatePressure: false,
        topology: "repair-self-intersections",
      }
    )));

    expect(tap.polygons).toHaveLength(1);
    expect(tap.vertexCount).toBeGreaterThan(8);
    expect(tap.bounds.width).toBeGreaterThan(8);
    expect(tap.bounds.height).toBeGreaterThan(8);
  });

  it("produces a wider silhouette for heavier pressure", async () => {
    const style = {
      mode: "ink",
      size: 16,
      thinning: 0.85,
      smoothing: 0.6,
      streamline: 0.05,
      simulatePressure: false,
      topology: "preserve",
    } as const;
    const light = artifact(await renderStudioHybridVectorGeometry(
      request(horizontalSamples(0.15), style)
    ));
    const heavy = artifact(await renderStudioHybridVectorGeometry(
      request(horizontalSamples(0.9), style)
    ));

    expect(heavy.bounds.height).toBeGreaterThan(light.bounds.height * 2);
    expect(light.receipt.backends.map((backend) => backend.packageName))
      .toEqual(["perfect-freehand"]);
  });

  it("repairs a self-crossing curve into simple canonical output rings", async () => {
    const repaired = artifact(await renderStudioHybridVectorGeometry(request(
      [
        { x: 0, y: 0, pressure: 0.6 },
        { x: 70, y: 70, pressure: 0.7 },
        { x: 0, y: 70, pressure: 0.5 },
        { x: 70, y: 0, pressure: 0.8 },
      ],
      {
        mode: "ink",
        size: 12,
        thinning: 0.7,
        smoothing: 0.2,
        streamline: 0,
        simulatePressure: false,
        topology: "repair-self-intersections",
      }
    )));

    expect(repaired.polygons.length).toBeGreaterThan(0);
    for (const polygon of repaired.polygons) {
      for (const ring of polygon) expect(hasStrictSelfIntersection(ring)).toBe(false);
    }
  });
});

describe("studio hybrid vector geometry — capability-driven hybrid paths", () => {
  it("unions overlapping pressure silhouettes only when robust topology is requested", async () => {
    const strokes = [
      { id: "left", points: horizontalSamples(0.7) },
      {
        id: "right",
        points: horizontalSamples(0.7).map((point) => ({ ...point, x: point.x + 45 })),
      },
    ] as const;
    const preserved = artifact(await renderStudioHybridVectorGeometry({
      contractVersion: STUDIO_HYBRID_VECTOR_CONTRACT_VERSION,
      strokes,
      style: {
        mode: "ink",
        size: 18,
        thinning: 0.5,
        simulatePressure: false,
        topology: "preserve",
      },
    }));
    const united = artifact(await renderStudioHybridVectorGeometry({
      contractVersion: STUDIO_HYBRID_VECTOR_CONTRACT_VERSION,
      strokes,
      style: {
        mode: "ink",
        size: 18,
        thinning: 0.5,
        simulatePressure: false,
        topology: "union-overlaps",
      },
    }));

    expect(preserved.polygons).toHaveLength(2);
    expect(united.polygons).toHaveLength(1);
    expect(preserved.receipt.usedCapabilities).toEqual(["pressure-outline"]);
    expect(united.receipt.usedCapabilities).toEqual(["pressure-outline", "robust-topology"]);
  });

  it("uses rough geometry only in explicit seeded sketch mode", async () => {
    const points = Array.from({ length: 19 }, (_, index) => ({
      x: index * 6,
      y: 50 + Math.sin(index / 3) * 20,
      pressure: 0.25 + index / 30,
    }));
    const sketchStyle = {
      mode: "sketch",
      size: 13,
      thinning: 0.75,
      simulatePressure: false,
      topology: "repair-self-intersections",
      seed: 42,
      roughness: 1.2,
      bowing: 0.8,
      sketchStrokeWidth: 1.5,
    } as const;
    const first = artifact(await renderStudioHybridVectorGeometry(request(points, sketchStyle)));
    const second = artifact(await renderStudioHybridVectorGeometry(request(points, sketchStyle)));
    const changedSeed = artifact(await renderStudioHybridVectorGeometry(request(
      points,
      { ...sketchStyle, seed: 43 }
    )));

    expect(second).toEqual(first);
    expect(first.sketchPaths.length).toBeGreaterThan(0);
    expect(changedSeed.polygons).toEqual(first.polygons);
    expect(changedSeed.sketchPaths).not.toEqual(first.sketchPaths);
    expect(first.receipt.usedCapabilities)
      .toEqual(["pressure-outline", "robust-topology", "seeded-sketch"]);
    for (const path of first.sketchPaths) {
      expect(path.commands.length).toBeGreaterThan(0);
      expect(path.commands.every((command) => (
        command.slice(1).every((value) => Number.isFinite(value))
      ))).toBe(true);
    }
  });
});

describe("studio hybrid vector geometry — neutral serialization and clean-room receipt", () => {
  it("keeps provenance versions and MIT evidence synchronized with installed packages", () => {
    const licenseFiles: Record<string, string> = {
      "perfect-freehand": "LICENSE",
      "polygon-clipping": "LICENSE.md",
      roughjs: "LICENSE",
    };
    for (const backend of STUDIO_HYBRID_VECTOR_CAPABILITY_RECEIPT.backends) {
      const packageRoot = resolve(process.cwd(), "node_modules", backend.packageName);
      const manifest = JSON.parse(
        readFileSync(resolve(packageRoot, "package.json"), "utf8")
      ) as { version?: unknown; license?: unknown };
      expect(manifest.version).toBe(backend.packageVersion);
      expect(manifest.license).toBe(backend.licenseSpdx);
      expect(readFileSync(resolve(packageRoot, licenseFiles[backend.packageName]!), "utf8"))
        .toMatch(/MIT License|The MIT License/u);
    }
  });

  it("publishes exact OSS provenance without persisting vendor objects or types", async () => {
    expect(STUDIO_HYBRID_VECTOR_CAPABILITY_RECEIPT.backends.map((backend) => ({
      packageName: backend.packageName,
      packageVersion: backend.packageVersion,
      licenseSpdx: backend.licenseSpdx,
      licenseNoticeRequired: backend.licenseNoticeRequired,
      provenance: backend.provenance,
      integrationBoundary: backend.integrationBoundary,
      replaceability: backend.replaceability,
      replacementFeasibility: backend.replacementFeasibility,
      replacementBasis: backend.replacementBasis,
      vendorTypesPersisted: backend.vendorTypesPersisted,
    }))).toEqual([
      {
        packageName: "perfect-freehand",
        packageVersion: "1.2.3",
        licenseSpdx: "MIT",
        licenseNoticeRequired: true,
        provenance: "installed-public-package-api",
        integrationBoundary: "existing-studio-lazy-wrapper",
        replaceability: "owned-port-independent-reimplementation",
        replacementFeasibility: "high",
        replacementBasis: "public-behavior-specification-only",
        vendorTypesPersisted: false,
      },
      {
        packageName: "polygon-clipping",
        packageVersion: "0.15.7",
        licenseSpdx: "MIT",
        licenseNoticeRequired: true,
        provenance: "installed-public-package-api",
        integrationBoundary: "existing-studio-lazy-wrapper",
        replaceability: "owned-port-independent-reimplementation",
        replacementFeasibility: "medium",
        replacementBasis: "public-behavior-specification-only",
        vendorTypesPersisted: false,
      },
      {
        packageName: "roughjs",
        packageVersion: "4.6.6",
        licenseSpdx: "MIT",
        licenseNoticeRequired: true,
        provenance: "installed-public-package-api",
        integrationBoundary: "existing-studio-lazy-wrapper",
        replaceability: "owned-port-independent-reimplementation",
        replacementFeasibility: "high",
        replacementBasis: "public-behavior-specification-only",
        vendorTypesPersisted: false,
      },
    ]);
    expect(STUDIO_HYBRID_VECTOR_CAPABILITY_RECEIPT.cleanRoomPolicy.prohibitedInputs)
      .toContain("proprietary-source");
    expect(STUDIO_HYBRID_VECTOR_CAPABILITY_RECEIPT.cleanRoomPolicy.prohibitedInputs)
      .toContain("paid-asset-copy");
    expect(STUDIO_HYBRID_VECTOR_CAPABILITY_RECEIPT.cleanRoomPolicy).toMatchObject({
      executionAdmission: "permissive-oss-only",
      restrictedImplementationClassification: "clean-room-spec-only",
      directPortClassification: "prohibited-direct-port",
      goldenCorpusOwnership: "toonspectrum-independent-behavior-corpus",
    });

    const rendered = artifact(await renderStudioHybridVectorGeometry(request(
      horizontalSamples(0.6),
      {
        mode: "sketch",
        size: 10,
        seed: 91,
        topology: "union-overlaps",
      }
    )));
    const cloned = structuredClone(rendered);
    expect(cloned).toEqual(rendered);
    expect(JSON.parse(JSON.stringify(rendered))).toEqual(rendered);
    expect(JSON.stringify(rendered)).not.toContain("Drawable");
    expect(JSON.stringify(rendered)).not.toContain("RoughGenerator");
  });

  it.each([
    {
      name: "wrong contract",
      input: { ...request(horizontalSamples(0.5), { mode: "ink", size: 10 }), contractVersion: 2 },
    },
    {
      name: "NaN coordinate",
      input: request([{ x: Number.NaN, y: 0 }], { mode: "ink", size: 10 }),
    },
    {
      name: "out-of-range pressure",
      input: request([{ x: 0, y: 0, pressure: 2 }], { mode: "ink", size: 10 }),
    },
    {
      name: "random sketch seed",
      input: request(horizontalSamples(0.5), { mode: "sketch", size: 10, seed: 0 }),
    },
    {
      name: "empty stroke",
      input: request([], { mode: "ink", size: 10 }),
    },
  ])("fails closed for malformed input: $name", async ({ input }) => {
    const result = await renderStudioHybridVectorGeometry(input as StudioHybridVectorRequest);
    expect(result).toEqual({
      ok: false,
      error: { code: "invalid-request", stage: "validation" },
    });
  });

  it("rejects duplicate stroke identities before loading a backend", async () => {
    const result = await renderStudioHybridVectorGeometry({
      contractVersion: STUDIO_HYBRID_VECTOR_CONTRACT_VERSION,
      strokes: [
        { id: "same", points: [{ x: 0, y: 0 }] },
        { id: "same", points: [{ x: 10, y: 10 }] },
      ],
      style: { mode: "ink", size: 10 },
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "invalid-request", stage: "validation" },
    });
  });
});
