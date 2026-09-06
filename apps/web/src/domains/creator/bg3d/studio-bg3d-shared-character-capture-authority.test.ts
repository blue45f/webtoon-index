import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  acquireStudioBg3dSharedCharacterCaptureAuthorityLease,
  snapshotStudioBg3dSharedCharacterCaptureAuthority,
  verifyStudioBg3dSharedCharacterCaptureAuthorityLease,
  type StudioBg3dSharedCharacterCaptureAuthorityInput,
  type StudioBg3dSharedCharacterCaptureIdentity,
} from "./studio-bg3d-shared-character-capture-authority";

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

function identity(
  elementId: string,
  sourceCharacter: string,
  modelCharacter: string,
  placementCharacter: string,
): StudioBg3dSharedCharacterCaptureIdentity {
  const sourceHash = hash(sourceCharacter);
  return {
    elementId,
    runtimeKey: `${elementId}:${sourceHash}`,
    modelRuntimeKey: `${elementId}:${hash(modelCharacter)}`,
    placementHash: hash(placementCharacter),
    sourceHash,
  };
}

const HERO = Object.freeze(identity("hero", "a", "b", "c"));
const GUIDE = Object.freeze(identity("guide", "d", "e", "f"));

function readyAuthority(
  overrides: Partial<StudioBg3dSharedCharacterCaptureAuthorityInput> = {},
): StudioBg3dSharedCharacterCaptureAuthorityInput {
  return {
    revision: 7,
    includeCharactersInCapture: true,
    readinessPhase: "ready",
    expectedCharacters: [HERO, GUIDE],
    capturableElementIds: ["hero", "guide"],
    previewOnlyElementIds: [],
    pendingElementIds: [],
    unavailableElementIds: [],
    ...overrides,
  };
}

function acquire(input = readyAuthority()) {
  const result = acquireStudioBg3dSharedCharacterCaptureAuthorityLease(input);
  if (!result.ok) throw new Error(`expected lease, received ${result.code}`);
  return result.lease;
}

describe("Shared Character capture authority lease", () => {
  it("snapshots exact identities and emits a deeply frozen full-fidelity lease", () => {
    const result = acquireStudioBg3dSharedCharacterCaptureAuthorityLease(readyAuthority({
      capturableElementIds: ["guide", "hero"],
    }));
    if (!result.ok) throw new Error("expected capture authority lease");

    expect(result.lease).toMatchObject({
      revision: 7,
      captureElementIds: ["hero", "guide"],
      snapshot: {
        revision: 7,
        includeCharactersInCapture: true,
        readinessPhase: "ready",
        expectedCharacters: [HERO, GUIDE],
        capturableElementIds: ["hero", "guide"],
        previewOnlyElementIds: [],
        pendingElementIds: [],
        unavailableElementIds: [],
      },
    });
    expect(result.lease.authorityHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.lease)).toBe(true);
    expect(Object.isFrozen(result.lease.snapshot)).toBe(true);
    expect(Object.isFrozen(result.lease.snapshot.expectedCharacters)).toBe(true);
    expect(Object.isFrozen(result.lease.snapshot.expectedCharacters[0])).toBe(true);
    expect(Object.isFrozen(result.lease.captureElementIds)).toBe(true);
  });

  it("defensively copies caller identities and memberships", () => {
    const mutableIdentity = identity("hero", "a", "b", "c") as {
      elementId: string;
      runtimeKey: string;
      modelRuntimeKey: string;
      placementHash: `sha256:${string}`;
      sourceHash: `sha256:${string}`;
    };
    const capturable = ["hero"];
    const input = readyAuthority({
      expectedCharacters: [mutableIdentity],
      capturableElementIds: capturable,
    });
    const lease = acquire(input);

    mutableIdentity.placementHash = hash("9");
    capturable[0] = "changed";

    expect(lease.snapshot.expectedCharacters[0]?.placementHash).toBe(hash("c"));
    expect(lease.captureElementIds).toEqual(["hero"]);
  });

  it("leases background-only capture while characters load but captures no character IDs", () => {
    const input = readyAuthority({
      includeCharactersInCapture: false,
      readinessPhase: "loading",
      capturableElementIds: ["hero"],
      pendingElementIds: ["guide"],
    });
    const lease = acquire(input);
    const raster = verifyStudioBg3dSharedCharacterCaptureAuthorityLease(
      lease,
      input,
      "raster",
    );

    expect(lease.captureElementIds).toEqual([]);
    expect(lease.snapshot.capturableElementIds).toEqual(["hero"]);
    expect(raster).toMatchObject({
      ok: true,
      checkpoint: "raster",
      captureElementIds: [],
    });
  });

  it.each([
    ["preview-only", readyAuthority({
      capturableElementIds: ["hero"],
      previewOnlyElementIds: ["guide"],
    })],
    ["loading", readyAuthority({
      readinessPhase: "loading",
      capturableElementIds: ["hero"],
      pendingElementIds: ["guide"],
    })],
    ["unavailable", readyAuthority({
      readinessPhase: "unavailable",
      capturableElementIds: ["hero"],
      unavailableElementIds: ["guide"],
    })],
  ] as const)("refuses a character-inclusive %s lease", (_label, input) => {
    expect(acquireStudioBg3dSharedCharacterCaptureAuthorityLease(input)).toEqual({
      ok: false,
      code: "capture-not-authoritative",
    });
    const snapshot = snapshotStudioBg3dSharedCharacterCaptureAuthority(input);
    expect(snapshot.ok).toBe(true);
  });

  it("verifies the same freshly observed authority at raster and receipt checkpoints", () => {
    const input = readyAuthority();
    const lease = acquire(input);

    for (const checkpoint of ["raster", "receipt"] as const) {
      const result = verifyStudioBg3dSharedCharacterCaptureAuthorityLease(
        lease,
        input,
        checkpoint,
      );
      expect(result).toMatchObject({
        ok: true,
        checkpoint,
        captureElementIds: ["hero", "guide"],
      });
      expect(Object.isFrozen(result)).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.snapshot)).toBe(true);
        expect(Object.isFrozen(result.captureElementIds)).toBe(true);
      }
    }
  });

  it.each(["raster", "receipt"] as const)(
    "rejects a revision advanced before the %s checkpoint",
    (checkpoint) => {
      const lease = acquire();
      expect(verifyStudioBg3dSharedCharacterCaptureAuthorityLease(
        lease,
        readyAuthority({ revision: 8 }),
        checkpoint,
      )).toEqual({ ok: false, code: "stale-lease" });
    },
  );

  it("rejects a regressed host revision instead of accepting a future lease", () => {
    const lease = acquire(readyAuthority({ revision: 8 }));
    expect(verifyStudioBg3dSharedCharacterCaptureAuthorityLease(
      lease,
      readyAuthority({ revision: 7 }),
      "raster",
    )).toEqual({ ok: false, code: "revision-regressed" });
  });

  it.each([
    ["element ID", readyAuthority({
      expectedCharacters: [identity("hero-2", "a", "b", "c"), GUIDE],
      capturableElementIds: ["hero-2", "guide"],
    })],
    ["runtime/source authority", readyAuthority({
      expectedCharacters: [identity("hero", "9", "b", "c"), GUIDE],
    })],
    ["model runtime authority", readyAuthority({
      expectedCharacters: [identity("hero", "a", "9", "c"), GUIDE],
    })],
    ["placement authority", readyAuthority({
      expectedCharacters: [identity("hero", "a", "b", "9"), GUIDE],
    })],
    ["include policy", readyAuthority({ includeCharactersInCapture: false })],
    ["readiness and membership", readyAuthority({
      includeCharactersInCapture: false,
      readinessPhase: "loading",
      capturableElementIds: ["hero"],
      pendingElementIds: ["guide"],
    })],
  ] as const)("fails closed when %s changes without a revision bump", (_label, current) => {
    const lease = acquire();
    expect(verifyStudioBg3dSharedCharacterCaptureAuthorityLease(
      lease,
      current,
      "receipt",
    )).toEqual({ ok: false, code: "authority-changed-without-revision" });
  });

  it.each([
    ["duplicate expected ID", readyAuthority({ expectedCharacters: [HERO, HERO] }),
      "duplicate-character-identity"],
    ["invalid expected ID", readyAuthority({
      expectedCharacters: [identity("bad/id", "a", "b", "c"), GUIDE],
    }), "invalid-character-identity"],
    ["duplicate member", readyAuthority({ capturableElementIds: ["hero", "hero"] }),
      "invalid-readiness-membership"],
    ["cross-list duplicate", readyAuthority({ previewOnlyElementIds: ["hero"] }),
      "invalid-readiness-membership"],
    ["unknown member", readyAuthority({ capturableElementIds: ["hero", "unknown"] }),
      "invalid-readiness-membership"],
    ["missing expected member", readyAuthority({ capturableElementIds: ["hero"] }),
      "invalid-readiness-membership"],
  ] as const)("rejects %s", (_label, input, code) => {
    expect(snapshotStudioBg3dSharedCharacterCaptureAuthority(input)).toEqual({
      ok: false,
      code,
    });
  });

  it.each([
    ["ready with pending IDs", readyAuthority({
      capturableElementIds: ["hero"],
      pendingElementIds: ["guide"],
    })],
    ["loading without pending IDs", readyAuthority({ readinessPhase: "loading" })],
    ["loading with a hard failure", readyAuthority({
      readinessPhase: "loading",
      capturableElementIds: ["hero"],
      unavailableElementIds: ["guide"],
    })],
    ["unavailable without unavailable IDs", readyAuthority({
      readinessPhase: "unavailable",
    })],
  ] as const)("rejects contradictory phase: %s", (_label, input) => {
    expect(snapshotStudioBg3dSharedCharacterCaptureAuthority(input)).toEqual({
      ok: false,
      code: "contradictory-readiness-phase",
    });
  });

  it.each([
    ["source hash", { ...HERO, sourceHash: hash("9") }],
    ["runtime key", { ...HERO, runtimeKey: `hero:${hash("9")}` }],
    ["model key", { ...HERO, modelRuntimeKey: "guide:sha256:bad" }],
    ["placement hash", { ...HERO, placementHash: "sha256:bad" }],
  ] as const)("rejects a malformed %s identity", (_label, malformed) => {
    expect(snapshotStudioBg3dSharedCharacterCaptureAuthority(readyAuthority({
      expectedCharacters: [malformed as StudioBg3dSharedCharacterCaptureIdentity, GUIDE],
    }))).toEqual({ ok: false, code: "invalid-character-identity" });
  });

  it("rejects malformed, tampered, and authority-equivalent forged leases", () => {
    const live = readyAuthority();
    const lease = acquire(live);
    const alteredAuthorityLease = acquire(readyAuthority({
      expectedCharacters: [identity("hero", "a", "9", "c"), GUIDE],
    }));
    const candidates: Array<readonly [unknown, string]> = [
      [{ ...lease, authorityHash: hash("9") }, "invalid-lease"],
      [{ ...lease, captureElementIds: ["guide"] }, "invalid-lease"],
      [{ ...lease, futureField: true }, "invalid-lease"],
      [{ ...lease, snapshot: { ...lease.snapshot, revision: 8 } }, "invalid-lease"],
      [alteredAuthorityLease, "authority-changed-without-revision"],
    ];

    for (const [candidate, code] of candidates) {
      expect(verifyStudioBg3dSharedCharacterCaptureAuthorityLease(
        candidate,
        live,
        "raster",
      )).toEqual({ ok: false, code });
    }
  });

  it("rejects malformed current state and runtime-forged checkpoints", () => {
    const lease = acquire();
    expect(verifyStudioBg3dSharedCharacterCaptureAuthorityLease(
      lease,
      { ...readyAuthority(), futureField: true },
      "receipt",
    )).toEqual({ ok: false, code: "invalid-current-authority" });
    expect(verifyStudioBg3dSharedCharacterCaptureAuthorityLease(
      lease,
      readyAuthority(),
      "persist" as "receipt",
    )).toEqual({ ok: false, code: "invalid-checkpoint" });
  });

  it("requires a positive safe-integer external revision", () => {
    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(snapshotStudioBg3dSharedCharacterCaptureAuthority(
        readyAuthority({ revision }),
      )).toEqual({ ok: false, code: "invalid-revision" });
    }
  });

  it("stays independent from React, Three, R3F, and renderer generation claims", () => {
    const source = readFileSync(
      new URL("./studio-bg3d-shared-character-capture-authority.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /from\s+["'](?:react(?:-dom)?|three(?:\/[^"']+)?|@react-three\/[^"']+)["']/u,
    );
    expect(source).toContain("does not invent a renderer/runtime generation");
    expect(source).toContain("host-owned fencing counter");
  });
});
