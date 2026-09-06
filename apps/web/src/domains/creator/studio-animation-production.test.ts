import {
  animationGraphIRSchema,
  applyMat2d,
  polylineToPath,
  sceneIRSchema,
  validateAnimationGraph,
} from "@toonspectrum/studio-project-model";
import { describe, expect, it } from "vitest";

import {
  cameraViewMatrix,
  renderAnimationFrames,
} from "./studio-animation-production";

import type {
  AnimationGraphIR,
  AnimationKeyframeIR,
  SceneIR,
  SceneNodeIR,
} from "@toonspectrum/studio-project-model";

function constantTrack(value: number): AnimationKeyframeIR[] {
  return [{ frame: 0, value, easing: "hold" }];
}

function celNode(celId: string): SceneNodeIR {
  return {
    id: `cel:${celId}`,
    kind: "fill-path",
    opacity: 1,
    blend: "src-over",
    path: polylineToPath(
      [
        [10, 5],
        [14, 5],
        [14, 9],
        [10, 9],
      ],
      true,
    ),
    paint: { kind: "solid", color: { r: 0, g: 0, b: 0, a: 1 } },
    fillRule: "nonzero",
  };
}

const resolveAll = (celId: string): SceneNodeIR[] => [celNode(celId)];

interface CameraSpec {
  x?: number;
  y?: number;
  scale?: number;
  rotationDeg?: number;
}

function graphWithCamera(camera: CameraSpec = {}): AnimationGraphIR {
  const graph = animationGraphIRSchema.parse({
    version: 1,
    fps: 24,
    durationFrames: 24,
    levels: [
      {
        id: "A",
        name: "캐릭터",
        cels: [
          { id: "A1", sceneNodeId: "layer-a1" },
          { id: "A2", sceneNodeId: "layer-a2" },
        ],
      },
    ],
    exposures: [
      { frame: 0, levelId: "A", celId: "A1" },
      { frame: 12, levelId: "A", celId: "A2" },
    ],
    camera: {
      x: constantTrack(camera.x ?? 0),
      y: constantTrack(camera.y ?? 0),
      scale: constantTrack(camera.scale ?? 1),
      rotationDeg: constantTrack(camera.rotationDeg ?? 0),
    },
  });
  expect(validateAnimationGraph(graph)).toEqual([]);
  return graph;
}

function firstPathNode(scene: SceneIR): Extract<SceneNodeIR, { kind: "fill-path" }> {
  const [node] = scene.nodes;
  if (node?.kind !== "fill-path") throw new Error("expected fill-path node");
  return node;
}

const SIZE = { widthPx: 32, heightPx: 32 };

describe("cameraViewMatrix", () => {
  it("bakes scale 2 as p' = 2·(p − c): camera target lands on the origin", () => {
    const view = cameraViewMatrix({ x: 10, y: 5, scale: 2, rotationDeg: 0 });
    expect(applyMat2d(view, 10, 5)).toEqual([0, 0]);
    expect(applyMat2d(view, 12, 7)).toEqual([4, 4]);
    expect(applyMat2d(view, 9, 4)).toEqual([-2, -2]);
  });

  it("bakes rotation 90° as p' = R(90)·(p − c)", () => {
    const view = cameraViewMatrix({ x: 0, y: 0, scale: 1, rotationDeg: 90 });
    const [x, y] = applyMat2d(view, 1, 0);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(1, 12);
  });

  it("composes scale then rotation about the camera pivot", () => {
    // c=(2,1), s=2, θ=90: p=(3,1) → (p−c)=(1,0) → ×2=(2,0) → R(90)=(0,2).
    const view = cameraViewMatrix({ x: 2, y: 1, scale: 2, rotationDeg: 90 });
    const [x, y] = applyMat2d(view, 3, 1);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(2, 12);
  });
});

describe("renderAnimationFrames", () => {
  it("bakes the scale-2 camera into node geometry (numeric fix)", () => {
    // Camera looks at the cel's top-left corner (10, 5) with scale 2: the
    // 4×4 cel square must bake to an 8×8 square anchored at the origin.
    const graph = graphWithCamera({ x: 10, y: 5, scale: 2 });
    const { frames } = renderAnimationFrames(graph, { from: 0, to: 0 }, resolveAll, SIZE);
    const frame = frames[0];
    if (!frame) throw new Error("expected frame 0");
    expect(frame.warnings).toEqual([]);
    const node = firstPathNode(frame.scene);
    expect(node.path.verbs[0]).toEqual({ v: "M", x: 0, y: 0 });
    expect(node.path.verbs[2]).toEqual({ v: "L", x: 8, y: 8 });
  });

  it("bakes the rotation-90 camera into node geometry (numeric fix)", () => {
    // Camera at the square's center (12, 7), θ=90: corner (14, 5) has offset
    // (2, −2) which rotates to (2, 2).
    const graph = graphWithCamera({ x: 12, y: 7, rotationDeg: 90 });
    const { frames } = renderAnimationFrames(graph, { from: 0, to: 0 }, resolveAll, SIZE);
    const frame = frames[0];
    if (!frame) throw new Error("expected frame 0");
    const node = firstPathNode(frame.scene);
    const corner = node.path.verbs[1];
    if (corner?.v !== "L") throw new Error("expected L verb");
    expect(corner.x).toBeCloseTo(2, 12);
    expect(corner.y).toBeCloseTo(2, 12);
  });

  it("assembles schema-valid scenes and honors X-sheet exposure holds", () => {
    const graph = graphWithCamera();
    const { frames } = renderAnimationFrames(graph, { from: 10, to: 13 }, resolveAll, {
      ...SIZE,
      background: { r: 0, g: 0, b: 0, a: 1 },
    });
    expect(frames.map((frame) => frame.frame)).toEqual([10, 11, 12, 13]);
    for (const frame of frames) {
      expect(sceneIRSchema.parse(frame.scene)).toEqual(frame.scene);
      expect(frame.scene.background).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    }
    // A1 holds through frame 11; A2 exposes from frame 12 and holds after.
    expect(frames.map((frame) => frame.scene.nodes[0]?.id)).toEqual([
      "cel:A1",
      "cel:A1",
      "cel:A2",
      "cel:A2",
    ]);
  });

  it("propagates unresolved-cel and out-of-duration warnings per frame", () => {
    const graph = graphWithCamera();
    const { frames } = renderAnimationFrames(
      graph,
      { from: 23, to: 24 },
      (celId) => (celId === "A2" ? null : [celNode(celId)]),
      SIZE,
    );
    const inRange = frames[0];
    const outOfRange = frames[1];
    if (!inRange || !outOfRange) throw new Error("expected two frames");
    expect(inRange.warnings.join("\n")).toContain("A2");
    expect(inRange.warnings.join("\n")).toContain("미해결");
    expect(inRange.scene.nodes).toEqual([]);
    expect(outOfRange.warnings.join("\n")).toContain("outside the graph duration");
  });

  it("reports a singular camera (scale 0) instead of silently flattening strokes", () => {
    const graph = graphWithCamera({ scale: 0 });
    const stroke: SceneNodeIR = {
      id: "stroke:s1",
      kind: "stroke-path",
      opacity: 1,
      blend: "src-over",
      path: polylineToPath(
        [
          [0, 0],
          [4, 0],
        ],
        false,
      ),
      paint: { kind: "solid", color: { r: 0, g: 0, b: 0, a: 1 } },
      strokeWidth: 2,
      cap: "round",
      join: "round",
      miterLimit: 4,
    };
    const { frames } = renderAnimationFrames(
      graph,
      { from: 0, to: 0 },
      () => [stroke],
      SIZE,
    );
    expect(frames[0]?.warnings.join("\n")).toContain("특이 행렬");
  });

  it("rejects non-integer and inverted frame ranges", () => {
    const graph = graphWithCamera();
    expect(() =>
      renderAnimationFrames(graph, { from: 0.5, to: 2 }, resolveAll, SIZE),
    ).toThrow(TypeError);
    expect(() =>
      renderAnimationFrames(graph, { from: 3, to: 2 }, resolveAll, SIZE),
    ).toThrow(RangeError);
  });

  it("is deterministic: same input → same sceneDigest, different camera → different digest", () => {
    const graph = graphWithCamera({ x: 3, y: 4, scale: 1.5, rotationDeg: 30 });
    const range = { from: 0, to: 5 };
    const first = renderAnimationFrames(graph, range, resolveAll, SIZE);
    const second = renderAnimationFrames(graph, range, resolveAll, SIZE);
    expect(second.frames.map((frame) => frame.sceneDigest)).toEqual(
      first.frames.map((frame) => frame.sceneDigest),
    );
    expect(second.frames).toEqual(first.frames);
    const moved = renderAnimationFrames(
      graphWithCamera({ x: 4, y: 4, scale: 1.5, rotationDeg: 30 }),
      range,
      resolveAll,
      SIZE,
    );
    expect(moved.frames[0]?.sceneDigest).not.toBe(first.frames[0]?.sceneDigest);
  });
});
