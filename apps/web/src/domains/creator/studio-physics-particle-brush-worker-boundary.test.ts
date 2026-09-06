import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const BASE = new URL(".", import.meta.url);

async function source(name: string): Promise<string> {
  return readFile(new URL(name, BASE), "utf8");
}

describe("Studio physics particle Worker architecture boundary", () => {
  it("keeps the CPU oracle outside protocol and client modules", async () => {
    const [protocol, client, host, entry] = await Promise.all([
      source("studio-physics-particle-brush-worker-protocol.ts"),
      source("studio-physics-particle-brush-worker-client.ts"),
      source("studio-physics-particle-brush-worker-host.ts"),
      source("studio-physics-particle-brush-provider.worker.ts"),
    ]);
    expect(protocol).toMatch(
      /import\s+type\s+\{[\s\S]*?\}\s+from\s+["']\.\/studio-physics-particle-brush-provider["'];/u,
    );
    expect(protocol).not.toContain(
      "createStudioPhysicsParticleBrushProvider",
    );
    expect(client).not.toMatch(
      /import[\s\S]*?from\s+["']\.\/studio-physics-particle-brush-provider["'];/u,
    );
    expect(client).not.toContain(
      "createStudioPhysicsParticleBrushProvider",
    );
    expect(host).toContain(
      'from "./studio-physics-particle-brush-provider"',
    );
    expect(entry).toContain(
      'from "./studio-physics-particle-brush-worker-host"',
    );
  });

  it("declares a dedicated Worker-only, hard-restart boundary", async () => {
    const [protocol, client] = await Promise.all([
      source("studio-physics-particle-brush-worker-protocol.ts"),
      source("studio-physics-particle-brush-worker-client.ts"),
    ]);
    expect(protocol).toContain("mainThreadComputationFallback: false");
    expect(protocol).toContain("maxResidentBytes");
    expect(protocol).toContain("maxWorkUnits");
    expect(client).toContain("new Worker(");
    expect(client).toContain("worker.terminate()");
    expect(client).toContain('"messageerror"');
    expect(client).toContain("startup-timeout");
    expect(client).toContain("operation-timeout");
    expect(client).toContain("#retireWorker");
    expect(client).toContain("addAbortListenerSafely");
    expect(client).toContain("removeAbortListenerSafely");
    expect(client).toContain("#operationReserved = true");
    expect(client).toContain("#snapshotController");
    expect(client).toContain("#cancelSnapshotReservation");
    expect(protocol).toContain("maximumArtifactPlaneBytes");
    expect(protocol).toContain("maximumOutputBytes * 2");
    expect(protocol).toContain(
      "snapshotStudioPhysicsParticleWorkerBaseCooperatively",
    );
    expect(protocol).toContain("canonicalWireStationsCooperatively");
    expect(protocol).toContain("clearTimeout(timer)");
  });

  it("does not pull canvas, DOM, React, or renderer engines into the boundary", async () => {
    const files = await Promise.all([
      source("studio-physics-particle-brush-worker-protocol.ts"),
      source("studio-physics-particle-brush-worker-client.ts"),
      source("studio-physics-particle-brush-worker-host.ts"),
      source("studio-physics-particle-brush-provider.worker.ts"),
    ]);
    const combined = files.join("\n");
    expect(combined).not.toMatch(
      /\b(document|window|HTMLCanvasElement|OffscreenCanvas)\b/u,
    );
    expect(combined).not.toMatch(
      /from\s+["'](?:react|konva|pixi\.js|three|@babylonjs)/u,
    );
  });

  it("transfers every typed-array family in both directions", async () => {
    const protocol = await source(
      "studio-physics-particle-brush-worker-protocol.ts",
    );
    for (const field of [
      "message.request.samples",
      "message.request.flowField.heights",
      "artifact.emitterStations",
      "artifact.path.positions",
      "artifact.path.particleIndices",
      "artifact.deposition.positions",
      "artifact.deposition.alpha",
      "artifact.connectors.segments",
      "artifact.connectors.alpha",
    ]) {
      expect(protocol).toContain(field);
    }
  });
});
