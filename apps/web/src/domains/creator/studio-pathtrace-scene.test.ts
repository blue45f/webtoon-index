import { describe, expect, it } from "vitest";

import {
  STUDIO_PATHTRACE_IDENTITY_MATRIX4,
  STUDIO_PATHTRACE_MAX_LIGHTS,
  STUDIO_PATHTRACE_MAX_PIXELS,
  appendStudioPathtraceMesh,
  appendStudioPathtraceTriangles,
  createStudioPathtraceMaterial,
  createStudioPathtraceSceneBuilder,
  finalizeStudioPathtraceScene,
  isStudioPathtraceResolutionAllowed,
  studioPathtraceCameraFromBg3d,
  validateStudioPathtraceScene,
} from "./studio-pathtrace-scene";

import type { StudioBg3dCanonicalGeometryPayload } from "./bg3d/studio-bg3d-geometry-worker-protocol";
import type {
  StudioPathtraceLight,
  StudioPathtraceScene,
  StudioPathtraceVec3,
} from "./studio-pathtrace-scene";

const CAMERA = {
  position: [0, 0, 3] as StudioPathtraceVec3,
  target: [0, 0, 0] as StudioPathtraceVec3,
  up: [0, 1, 0] as StudioPathtraceVec3,
  fovYRadians: Math.PI / 4,
};

function makeScene(overrides: Partial<StudioPathtraceScene> = {}): StudioPathtraceScene {
  const builder = createStudioPathtraceSceneBuilder();
  appendStudioPathtraceTriangles(builder, [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], 0);
  const scene = finalizeStudioPathtraceScene(builder, {
    materials: [createStudioPathtraceMaterial()],
    lights: [],
    environment: { kind: "constant", radianceLinear: [1, 1, 1] },
    camera: CAMERA,
  });
  return { ...scene, ...overrides };
}

function makePayload(
  positions: number[],
  indices: number[] | null,
  normals?: number[],
): StudioBg3dCanonicalGeometryPayload {
  const attributes: StudioBg3dCanonicalGeometryPayload["attributes"] = [
    {
      name: "position",
      itemSize: 3,
      count: positions.length / 3,
      normalized: false,
      arrayType: "float32",
      buffer: Float32Array.from(positions).buffer,
    },
    ...(normals
      ? [
          {
            name: "normal" as const,
            itemSize: 3 as const,
            count: normals.length / 3,
            normalized: false as const,
            arrayType: "float32" as const,
            buffer: Float32Array.from(normals).buffer,
          },
        ]
      : []),
  ];
  return {
    format: "ply",
    kind: "mesh",
    vertexCount: positions.length / 3,
    triangleCount: indices ? indices.length / 3 : positions.length / 9,
    byteLength: positions.length * 4,
    attributes,
    index: indices
      ? { count: indices.length, arrayType: "uint32", buffer: Uint32Array.from(indices).buffer }
      : null,
  };
}

describe("빌더", () => {
  it("raw 삼각형 추가는 정점 오프셋을 이어 붙인다", () => {
    const builder = createStudioPathtraceSceneBuilder();
    appendStudioPathtraceTriangles(builder, [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], 0);
    appendStudioPathtraceTriangles(builder, [2, 0, 0, 3, 0, 0, 2, 1, 0], [0, 1, 2], 1);
    const scene = finalizeStudioPathtraceScene(builder, {
      materials: [createStudioPathtraceMaterial(), createStudioPathtraceMaterial()],
      lights: [],
      environment: { kind: "constant", radianceLinear: [1, 1, 1] },
      camera: CAMERA,
    });
    expect(scene.triangleCount).toBe(2);
    expect(scene.vertexCount).toBe(6);
    expect(Array.from(scene.indices)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(scene.triMaterial)).toEqual([0, 1]);
    // 노멀 속성을 주지 않았으므로 씬 전체가 지오메트릭 노멀로 떨어진다.
    expect(scene.normals).toBeNull();
  });

  it("인덱스 지오메트리 payload 에 월드 변환을 적용한다", () => {
    const builder = createStudioPathtraceSceneBuilder();
    // 스케일 2 + x 로 5 이동(열 우선).
    const matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 0, 0, 1];
    const ok = appendStudioPathtraceMesh(
      builder,
      makePayload([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], [0, 0, 1, 0, 0, 1, 0, 0, 1]),
      matrix,
      0,
    );
    expect(ok).toBe(true);
    const scene = finalizeStudioPathtraceScene(builder, {
      materials: [createStudioPathtraceMaterial()],
      lights: [],
      environment: { kind: "constant", radianceLinear: [1, 1, 1] },
      camera: CAMERA,
    });
    expect(Array.from(scene.positions)).toEqual([5, 0, 0, 7, 0, 0, 5, 2, 0]);
    expect(scene.normals).not.toBeNull();
    // 균등 스케일이라 노멀은 정규화 후 그대로다.
    expect(Array.from(scene.normals as Float32Array)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it("non-indexed payload 는 순차 인덱스를 만든다", () => {
    const builder = createStudioPathtraceSceneBuilder();
    appendStudioPathtraceMesh(
      builder,
      makePayload([0, 0, 0, 1, 0, 0, 0, 1, 0], null),
      STUDIO_PATHTRACE_IDENTITY_MATRIX4,
      0,
    );
    const scene = finalizeStudioPathtraceScene(builder, {
      materials: [createStudioPathtraceMaterial()],
      lights: [],
      environment: { kind: "constant", radianceLinear: [1, 1, 1] },
      camera: CAMERA,
    });
    expect(Array.from(scene.indices)).toEqual([0, 1, 2]);
    expect(scene.triangleCount).toBe(1);
  });

  it("points 클라우드는 무시한다(패스트레이싱 대상 아님)", () => {
    const builder = createStudioPathtraceSceneBuilder();
    const payload = { ...makePayload([0, 0, 0], null), kind: "points" as const };
    expect(appendStudioPathtraceMesh(builder, payload, STUDIO_PATHTRACE_IDENTITY_MATRIX4, 0)).toBe(false);
    expect(builder.positions.length).toBe(0);
  });
});

describe("카메라 어댑터", () => {
  it("bg3d 설정을 fovY 라디안으로 옮긴다", () => {
    const cam = studioPathtraceCameraFromBg3d({
      position: [1, 2, 3],
      target: [0, 0, 0],
      fovDegrees: 45,
    });
    expect(cam.fovYRadians).toBeCloseTo(Math.PI / 4, 12);
    expect(cam.position).toEqual([1, 2, 3]);
    expect(cam.up).toEqual([0, 1, 0]);
  });

  it("zoom 은 fov 를 나누고, 각도는 1~179도로 제한된다", () => {
    const zoomed = studioPathtraceCameraFromBg3d({
      position: [0, 0, 5],
      target: [0, 0, 0],
      fovDegrees: 60,
      zoom: 2,
    });
    expect((zoomed.fovYRadians * 180) / Math.PI).toBeCloseTo(30, 10);
    const clamped = studioPathtraceCameraFromBg3d({
      position: [0, 0, 5],
      target: [0, 0, 0],
      fovDegrees: 60,
      zoom: 0.01,
    });
    expect((clamped.fovYRadians * 180) / Math.PI).toBeCloseTo(179, 10);
  });
});

describe("validateStudioPathtraceScene — fail-closed", () => {
  it("정상 씬은 ok", () => {
    expect(validateStudioPathtraceScene(makeScene())).toEqual({ ok: true });
  });

  it("빈 지오메트리", () => {
    const scene = makeScene({ indices: new Uint32Array(0), positions: new Float32Array(0) });
    const result = validateStudioPathtraceScene(scene);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("empty-geometry");
  });

  it("인덱스 개수가 3의 배수가 아님", () => {
    const result = validateStudioPathtraceScene(makeScene({ indices: Uint32Array.from([0, 1]) }));
    expect(result.ok === false && result.code).toBe("index-count-not-multiple-of-3");
  });

  it("범위 밖 정점 인덱스", () => {
    const result = validateStudioPathtraceScene(makeScene({ indices: Uint32Array.from([0, 1, 99]) }));
    expect(result.ok === false && result.code).toBe("index-out-of-range");
  });

  it("범위 밖 머티리얼 인덱스", () => {
    const result = validateStudioPathtraceScene(makeScene({ triMaterial: Uint32Array.from([7]) }));
    expect(result.ok === false && result.code).toBe("material-index-out-of-range");
  });

  it("NaN 좌표와 좌표 상한", () => {
    const nan = makeScene({ positions: Float32Array.from([0, 0, 0, 1, 0, 0, Number.NaN, 1, 0]) });
    expect(validateStudioPathtraceScene(nan).ok === false
      && (validateStudioPathtraceScene(nan) as { code: string }).code).toBe("non-finite-position");
    const far = makeScene({ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 5e6, 1, 0]) });
    expect((validateStudioPathtraceScene(far) as { code: string }).code).toBe("position-out-of-range");
  });

  it("머티리얼 범위 위반", () => {
    const bad = makeScene({ materials: [createStudioPathtraceMaterial({ roughness: 2 })] });
    expect((validateStudioPathtraceScene(bad) as { code: string }).code).toBe("invalid-material-range");
    const negative = makeScene({ materials: [createStudioPathtraceMaterial({ baseColorLinear: [-1, 0, 0] })] });
    expect((validateStudioPathtraceScene(negative) as { code: string }).code).toBe("invalid-material-range");
    const badIor = makeScene({ materials: [createStudioPathtraceMaterial({ ior: 0.5 })] });
    expect((validateStudioPathtraceScene(badIor) as { code: string }).code).toBe("invalid-material-range");
  });

  it("퇴화 면적 광원", () => {
    const light: StudioPathtraceLight = {
      kind: "area",
      origin: [0, 0, 0],
      edgeU: [1, 0, 0],
      edgeV: [2, 0, 0],
      emissiveLinear: [1, 1, 1],
      twoSided: false,
    };
    expect((validateStudioPathtraceScene(makeScene({ lights: [light] })) as { code: string }).code)
      .toBe("degenerate-area-light");
  });

  it("광원 개수 상한", () => {
    const light: StudioPathtraceLight = {
      kind: "point",
      positionWorld: [0, 1, 0],
      intensityLinear: [1, 1, 1],
      radius: 0,
    };
    const tooMany = new Array(STUDIO_PATHTRACE_MAX_LIGHTS + 1).fill(light);
    expect((validateStudioPathtraceScene(makeScene({ lights: tooMany })) as { code: string }).code)
      .toBe("light-budget-exceeded");
  });

  it("카메라 퇴화와 fov 범위", () => {
    const same = makeScene({ camera: { ...CAMERA, target: [0, 0, 3] } });
    expect((validateStudioPathtraceScene(same) as { code: string }).code).toBe("degenerate-camera");
    const parallelUp = makeScene({ camera: { ...CAMERA, up: [0, 0, -1] } });
    expect((validateStudioPathtraceScene(parallelUp) as { code: string }).code).toBe("degenerate-camera");
    const badFov = makeScene({ camera: { ...CAMERA, fovYRadians: 0 } });
    expect((validateStudioPathtraceScene(badFov) as { code: string }).code).toBe("invalid-fov");
    const wideFov = makeScene({ camera: { ...CAMERA, fovYRadians: Math.PI } });
    expect((validateStudioPathtraceScene(wideFov) as { code: string }).code).toBe("invalid-fov");
  });

  it("triMaterial 개수 불일치와 노멀 길이 불일치", () => {
    expect((validateStudioPathtraceScene(makeScene({ triMaterial: Uint32Array.from([0, 0]) })) as {
      code: string;
    }).code).toBe("tri-material-count-mismatch");
    expect((validateStudioPathtraceScene(makeScene({ normals: new Float32Array(3) })) as {
      code: string;
    }).code).toBe("normal-count-mismatch");
  });

  it("예외를 던지지 않고 코드 판별자만 돌려준다", () => {
    expect(() => validateStudioPathtraceScene(makeScene({ indices: Uint32Array.from([9, 9, 9]) }))).not.toThrow();
  });
});

describe("해상도 예산", () => {
  it("정수 양수만 허용하고 픽셀 상한을 지킨다", () => {
    expect(isStudioPathtraceResolutionAllowed(1920, 1080)).toBe(true);
    expect(isStudioPathtraceResolutionAllowed(2048, 2048)).toBe(true);
    expect(isStudioPathtraceResolutionAllowed(4096, 4096)).toBe(false);
    expect(isStudioPathtraceResolutionAllowed(0, 100)).toBe(false);
    expect(isStudioPathtraceResolutionAllowed(10.5, 10)).toBe(false);
    expect(2048 * 2048).toBe(STUDIO_PATHTRACE_MAX_PIXELS);
  });
});
