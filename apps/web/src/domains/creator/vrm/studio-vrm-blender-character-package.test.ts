import { describe, expect, it } from "vitest";

import {
  parseStudioVrmBlenderCharacterPackage,
  selectStudioVrmBlenderRuntimeAsset,
} from "./studio-vrm-blender-character-package";

const FILE = {
  path: "avatar-orion-authored.vrm",
  bytes: 1024,
  sha256: "a".repeat(64),
};

const PACKAGE = {
  schemaVersion: 1,
  kind: "toonstudio.character-package",
  characterId: "avatar-orion-authored",
  displayName: "Avatar Orion",
  configDigest: "b".repeat(64),
  pipelineVersion: 1,
  capabilities: {
    authoredHair: {
      enabled: true,
      style: "short-layered",
      lodTriangles: [20000, 10000, 5000],
      replacedSourceMeshes: [],
    },
    semanticFaceShapes: {
      mode: "semantic-shape-keys",
      confidence: 0.9,
      objects: ["Face"],
      shapeKeys: ["Face:faceEyeSizeBig"],
    },
    mtoonReady: true,
    vrmCustomExpressions: {
      status: "ready",
      names: ["tsFaceEyeSizeBig", "tsFaceEyeSizeSmall"],
    },
    lods: true,
  },
  quality: {
    score: 94,
    passed: true,
    minimumScore: 86,
    report: "quality-report.json",
  },
  files: { vrm: FILE, glb: { ...FILE, path: "avatar-orion-authored.glb" } },
  provenance: { license: "CC0" },
};

describe("Blender character package boundary", () => {
  it("parses a verified package and prefers VRM for the character runtime", () => {
    const parsed = parseStudioVrmBlenderCharacterPackage(PACKAGE);
    expect(parsed.capabilities.authoredHair.lodTriangles).toEqual([20000, 10000, 5000]);
    expect(parsed.capabilities.vrmCustomExpressions.names).toContain("tsFaceEyeSizeBig");
    expect(selectStudioVrmBlenderRuntimeAsset(parsed)).toMatchObject({
      role: "vrm",
      file: { path: "avatar-orion-authored.vrm" },
    });
  });

  it("can deliberately prefer GLB without silently accepting a failed package", () => {
    const parsed = parseStudioVrmBlenderCharacterPackage(PACKAGE);
    expect(selectStudioVrmBlenderRuntimeAsset(parsed, { prefer: "glb" }).role).toBe("glb");
    const failed = parseStudioVrmBlenderCharacterPackage({
      ...PACKAGE,
      quality: { ...PACKAGE.quality, passed: false },
    });
    expect(() => selectStudioVrmBlenderRuntimeAsset(failed)).toThrow(/quality gate/u);
  });

  it("rejects traversal, malformed digests, and packages without runtime assets", () => {
    expect(() => parseStudioVrmBlenderCharacterPackage({
      ...PACKAGE,
      files: { vrm: { ...FILE, path: "../secret.vrm" } },
    })).toThrow(/unsafe path/u);
    expect(() => parseStudioVrmBlenderCharacterPackage({
      ...PACKAGE,
      files: { vrm: { ...FILE, sha256: "broken" } },
    })).toThrow(/SHA-256/u);
    expect(() => parseStudioVrmBlenderCharacterPackage({ ...PACKAGE, files: {} })).toThrow(/VRM or GLB/u);
    expect(() => parseStudioVrmBlenderCharacterPackage({ ...PACKAGE, configDigest: "broken" })).toThrow(/configDigest/u);
  });
});
