import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const harness = readFileSync(
  resolve(process.cwd(), "scripts/verify-studio-bg3d-physics.mts"),
  "utf8",
);

describe("Studio BG3D physics browser harness boundary", () => {
  it("honors the physics-specific temporary artifact directory before the legacy alias", () => {
    const physicsDirectory = harness.indexOf(
      "process.env.TOONSPECTRUM_BG3D_PHYSICS_VERIFY_DIR",
    );
    const legacyDirectory = harness.indexOf(
      "process.env.TOONSPECTRUM_BG3D_VERIFY_DIR",
    );
    const repositoryFallback = harness.indexOf(
      'join(process.cwd(), "artifacts", "browser", "studio-bg3d-physics")',
    );

    expect(physicsDirectory).toBeGreaterThanOrEqual(0);
    expect(legacyDirectory).toBeGreaterThan(physicsDirectory);
    expect(repositoryFallback).toBeGreaterThan(legacyDirectory);
  });

  it("allows only the exact local preview Socket.IO handshake shutdown contract", () => {
    expect(harness).toContain('previewUrl.hostname !== "127.0.0.1"');
    expect(harness).toContain("previewUrl.port.length === 0");
    expect(harness).toContain(
      "`ws://127.0.0.1:${previewUrl.port}/socket.io/?EIO=4&transport=websocket`",
    );
    expect(harness).toContain(
      '"Connection closed before receiving a handshake response"',
    );
    expect(harness).toContain("message === expectedMessage");
    expect(harness).toContain("sourceUrl.origin === previewUrl.origin");
    expect(harness).toContain(
      "/^\\/assets\\/[A-Za-z0-9._-]+\\.js$/u.test(sourceUrl.pathname)",
    );
    expect(harness).not.toContain(
      `message.includes("WebSocket connection to 'ws://127.0.0.1:")`,
    );
  });

  it("does not hide the removed visit-ping path from browser health failures", () => {
    expect(harness).not.toContain("/api/v1/apps/toonspectrum/visits/ping");
    expect(harness).toContain('"/api/kmas/merge-on-access"');
    expect(harness).toContain('"/api/studio-ai/status"');
  });
});
