import { describe, expect, it } from "vitest";

import {
  createStudioBg3dPhysicsSessionSourceToken,
  isStudioBg3dPhysicsSessionSourceCurrent,
} from "./studio-bg3d-physics-session";

describe("studio bg3d physics session source token", () => {
  const source = {
    primitives: [{ id: "box", position: [0, 1, 0], rotation: [0, 0, 0] }],
    customModels: [{ id: "prop", animation: undefined }],
    document: { version: 3, environment: { intensity: 1 } },
  };

  it("is stable across deep clones and object key insertion order", () => {
    const reordered = {
      document: { environment: { intensity: 1 }, version: 3 },
      customModels: [{ animation: undefined, id: "prop" }],
      primitives: [{ rotation: [0, 0, 0], position: [0, 1, 0], id: "box" }],
    };
    const token = createStudioBg3dPhysicsSessionSourceToken(source);

    expect(token).not.toBeNull();
    expect(createStudioBg3dPhysicsSessionSourceToken(reordered)).toBe(token);
    expect(isStudioBg3dPhysicsSessionSourceCurrent(token!, reordered)).toBe(true);
  });

  it("detects transform, animation, and base-document changes", () => {
    const token = createStudioBg3dPhysicsSessionSourceToken(source)!;

    expect(isStudioBg3dPhysicsSessionSourceCurrent(token, {
      ...source,
      primitives: [{ ...source.primitives[0], position: [2, 1, 0] }],
    })).toBe(false);
    expect(isStudioBg3dPhysicsSessionSourceCurrent(token, {
      ...source,
      customModels: [{ id: "prop", animation: { playing: false, timeSeconds: 1 } }],
    })).toBe(false);
    expect(isStudioBg3dPhysicsSessionSourceCurrent(token, {
      ...source,
      document: { version: 3, environment: { intensity: 0.5 } },
    })).toBe(false);
  });

  it("fails closed for lossy or non-serializable source values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(createStudioBg3dPhysicsSessionSourceToken({ value: Number.NaN })).toBeNull();
    expect(createStudioBg3dPhysicsSessionSourceToken({ value: Number.POSITIVE_INFINITY })).toBeNull();
    expect(createStudioBg3dPhysicsSessionSourceToken({ value: () => undefined })).toBeNull();
    expect(createStudioBg3dPhysicsSessionSourceToken({ values: [undefined] })).toBeNull();
    expect(createStudioBg3dPhysicsSessionSourceToken(cyclic)).toBeNull();
    expect(isStudioBg3dPhysicsSessionSourceCurrent("", source)).toBe(false);
  });

  it("canonicalizes negative zero without hiding ordinary numeric differences", () => {
    expect(createStudioBg3dPhysicsSessionSourceToken({ value: -0 })).toBe(
      createStudioBg3dPhysicsSessionSourceToken({ value: 0 }),
    );
    expect(createStudioBg3dPhysicsSessionSourceToken({ value: 0.001 })).not.toBe(
      createStudioBg3dPhysicsSessionSourceToken({ value: 0.002 }),
    );
  });
});
