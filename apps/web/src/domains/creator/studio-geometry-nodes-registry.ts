/**
 * 지오메트리 노드 — 노드 카탈로그(소켓 시그니처 · 파라미터 스키마 · 평가 바인딩).
 *
 * 레지스트리는 **주입 가능**하다. 평가기(`studio-geometry-nodes-eval.ts`)는 기본 레지스트리를
 * 쓰지만 테스트는 호출 횟수를 세는 스텁 레지스트리를 넣어 메모이제이션이 실제로 재계산을
 * 건너뛰는지 정수로 검증한다. 이 심이 없으면 "캐시가 돌았다"를 관측할 방법이 없다.
 *
 * 노드 하나의 계약:
 *  - `inputs`/`outputs` 는 소켓 시그니처(그래프 검증이 타입 정합을 여기서 읽는다).
 *  - `params` 는 UI 가 그릴 스키마이자 캐시 키의 재료다.
 *  - `evaluate(ctx)` 는 순수 함수여야 한다 — 같은 입력·파라미터면 같은 출력.
 *    시드는 반드시 파라미터로 들어오고, 노드가 스스로 난수를 만들지 않는다.
 *
 * ## 카탈로그 범위(정직성)
 * 프리미티브 4 · transform · join · subdivide · extrude · distribute-points · instance-on-points ·
 * boolean · noise · random · attribute-math · vector 상수 · output = 15종.
 * 블렌더의 수백 개 노드, 필드 시스템, 노드 그룹은 없다.
 */

import {
  isStudioGeometryBooleanOp,
  STUDIO_GEOMETRY_BOOLEAN_OPS,
  studioGeometryPlanarBoolean,
} from "./studio-geometry-nodes-boolean";
import {
  studioGeometryClamp,
  studioGeometryFail,
  studioGeometryOk,
  studioGeometryVertexCount,
} from "./studio-geometry-nodes-mesh";
import {
  isStudioGeometryAttributeMathOp,
  STUDIO_GEOMETRY_ATTRIBUTE_MATH_OPS,
  STUDIO_GEOMETRY_MAX_SUBDIVIDE_ITERATIONS,
  studioGeometryAttributeMath,
  studioGeometryDistributePointsOnFaces,
  studioGeometryExtrude,
  studioGeometryInstanceOnPoints,
  studioGeometryJoin,
  studioGeometryPositionAttribute,
  studioGeometrySubdivide,
  studioGeometryTransform,
  studioGeometryWithPositions,
} from "./studio-geometry-nodes-ops";
import {
  studioGeometryCube,
  studioGeometryCylinder,
  studioGeometryGrid,
  studioGeometrySphere,
} from "./studio-geometry-nodes-primitives";
import {
  createStudioGeometryRandom,
  studioGeometryFractalNoise3,
} from "./studio-geometry-nodes-random";

import type { StudioGeometryNodesPlanarBooleanBackend } from "./studio-geometry-nodes-boolean";
import type {
  StudioGeometryParamValue,
  StudioGeometrySocketSpec,
  StudioGeometrySocketType,
} from "./studio-geometry-nodes-graph";
import type {
  StudioGeometryBudgets,
  StudioGeometryMesh,
  StudioGeometryPoints,
  StudioGeometryResult,
} from "./studio-geometry-nodes-mesh";
import type { StudioGeometryVec3 } from "./studio-geometry-nodes-ops";

// ---------------------------------------------------------------------------
// 값 · 컨텍스트
// ---------------------------------------------------------------------------

export type StudioGeometryValue =
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "geometry"; readonly mesh: StudioGeometryMesh }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "points"; readonly points: StudioGeometryPoints }
  | { readonly kind: "vector"; readonly value: StudioGeometryVec3 };

export type StudioGeometryOutputs = Readonly<Record<string, StudioGeometryValue>>;

export interface StudioGeometryNodeEvalContext {
  readonly params: Readonly<Record<string, StudioGeometryParamValue>>;
  readonly inputs: Readonly<Record<string, StudioGeometryValue | undefined>>;
  readonly booleanBackend: StudioGeometryNodesPlanarBooleanBackend | null;
  readonly budgets: StudioGeometryBudgets;
}

export interface StudioGeometryParamSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: "bool" | "enum" | "float" | "int";
  readonly defaultValue: StudioGeometryParamValue;
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

export interface StudioGeometryNodeDefinition {
  readonly type: string;
  readonly label: string;
  readonly summary: string;
  readonly inputs: readonly StudioGeometrySocketSpec[];
  readonly outputs: readonly StudioGeometrySocketSpec[];
  readonly params: readonly StudioGeometryParamSpec[];
  readonly evaluate: (
    ctx: StudioGeometryNodeEvalContext
  ) => StudioGeometryResult<StudioGeometryOutputs>;
}

export interface StudioGeometryNodeRegistry {
  readonly get: (type: string) => StudioGeometryNodeDefinition | undefined;
  readonly list: () => readonly StudioGeometryNodeDefinition[];
}

export function createStudioGeometryNodeRegistry(
  definitions: readonly StudioGeometryNodeDefinition[]
): StudioGeometryNodeRegistry {
  const byType = new Map<string, StudioGeometryNodeDefinition>();
  for (const definition of definitions) byType.set(definition.type, definition);
  const ordered = [...byType.values()];
  return { get: (type) => byType.get(type), list: () => ordered };
}

// ---------------------------------------------------------------------------
// 파라미터 헬퍼
// ---------------------------------------------------------------------------

function paramFloat(
  ctx: StudioGeometryNodeEvalContext,
  key: string,
  fallback: number
): number {
  const raw = ctx.params[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function paramInt(ctx: StudioGeometryNodeEvalContext, key: string, fallback: number): number {
  const raw = ctx.params[key];
  return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : fallback;
}

function paramBool(ctx: StudioGeometryNodeEvalContext, key: string, fallback: boolean): boolean {
  const raw = ctx.params[key];
  return typeof raw === "boolean" ? raw : fallback;
}

function paramString(ctx: StudioGeometryNodeEvalContext, key: string, fallback: string): string {
  const raw = ctx.params[key];
  return typeof raw === "string" ? raw : fallback;
}

/** 연결된 소켓이 있으면 그 값, 없으면 파라미터. 소켓 타입이 다르면 undefined. */
function inputFloat(ctx: StudioGeometryNodeEvalContext, key: string, fallback: number): number {
  const value = ctx.inputs[key];
  if (value && (value.kind === "float" || value.kind === "int")) return value.value;
  return fallback;
}

function inputInt(ctx: StudioGeometryNodeEvalContext, key: string, fallback: number): number {
  const value = ctx.inputs[key];
  if (value && (value.kind === "int" || value.kind === "float")) return Math.trunc(value.value);
  return fallback;
}

function inputBool(ctx: StudioGeometryNodeEvalContext, key: string, fallback: boolean): boolean {
  const value = ctx.inputs[key];
  if (value && value.kind === "bool") return value.value;
  return fallback;
}

function inputVector(
  ctx: StudioGeometryNodeEvalContext,
  key: string,
  fallback: StudioGeometryVec3
): StudioGeometryVec3 {
  const value = ctx.inputs[key];
  if (value && value.kind === "vector") return value.value;
  return fallback;
}

function requireMesh(
  ctx: StudioGeometryNodeEvalContext,
  key: string
): StudioGeometryResult<StudioGeometryMesh> {
  const value = ctx.inputs[key];
  if (!value) return studioGeometryFail("missing-input", `입력 "${key}" 가 연결되지 않았습니다.`);
  if (value.kind !== "geometry") {
    return studioGeometryFail("input-type-mismatch", `입력 "${key}" 는 지오메트리여야 합니다.`);
  }
  return studioGeometryOk(value.mesh);
}

function requirePoints(
  ctx: StudioGeometryNodeEvalContext,
  key: string
): StudioGeometryResult<StudioGeometryPoints> {
  const value = ctx.inputs[key];
  if (!value) return studioGeometryFail("missing-input", `입력 "${key}" 가 연결되지 않았습니다.`);
  if (value.kind !== "points") {
    return studioGeometryFail("input-type-mismatch", `입력 "${key}" 는 포인트여야 합니다.`);
  }
  return studioGeometryOk(value.points);
}

function geometryOut(mesh: StudioGeometryMesh): StudioGeometryOutputs {
  return { geometry: { kind: "geometry", mesh } };
}

function socket(
  key: string,
  label: string,
  type: StudioGeometrySocketType,
  optional = false
): StudioGeometrySocketSpec {
  return { key, label, type, optional };
}

const DEGREES_TO_RADIANS = Math.PI / 180;

// ---------------------------------------------------------------------------
// 노드 정의
// ---------------------------------------------------------------------------

const cubeNode: StudioGeometryNodeDefinition = {
  type: "mesh-cube",
  label: "정육면체",
  summary: "면마다 정점을 분리한 박스. 세그먼트를 올리면 면이 격자로 쪼개집니다.",
  inputs: [],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [
    { key: "size", label: "크기", kind: "float", defaultValue: 1, min: 0.001, max: 1000 },
    { key: "segments", label: "세그먼트", kind: "int", defaultValue: 1, min: 1, max: 256 },
  ],
  evaluate: (ctx) => {
    const built = studioGeometryCube(
      { size: paramFloat(ctx, "size", 1), segments: paramInt(ctx, "segments", 1) },
      ctx.budgets
    );
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const sphereNode: StudioGeometryNodeDefinition = {
  type: "mesh-sphere",
  label: "UV 구",
  summary: "위도·경도 격자 구. 극에서는 퇴화 삼각형을 만들지 않습니다.",
  inputs: [],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [
    { key: "radius", label: "반지름", kind: "float", defaultValue: 0.5, min: 0.001, max: 1000 },
    { key: "segments", label: "경도 분할", kind: "int", defaultValue: 24, min: 3, max: 256 },
    { key: "rings", label: "위도 분할", kind: "int", defaultValue: 16, min: 2, max: 256 },
  ],
  evaluate: (ctx) => {
    const built = studioGeometrySphere(
      {
        radius: paramFloat(ctx, "radius", 0.5),
        segments: paramInt(ctx, "segments", 24),
        rings: paramInt(ctx, "rings", 16),
      },
      ctx.budgets
    );
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const cylinderNode: StudioGeometryNodeDefinition = {
  type: "mesh-cylinder",
  label: "원기둥",
  summary: "옆면 + 선택형 캡. 캡을 끄면 열린 튜브가 됩니다.",
  inputs: [],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [
    { key: "radius", label: "반지름", kind: "float", defaultValue: 0.3, min: 0.001, max: 1000 },
    { key: "height", label: "높이", kind: "float", defaultValue: 1, min: 0.001, max: 1000 },
    { key: "segments", label: "둘레 분할", kind: "int", defaultValue: 16, min: 3, max: 256 },
    { key: "caps", label: "캡", kind: "bool", defaultValue: true },
  ],
  evaluate: (ctx) => {
    const built = studioGeometryCylinder(
      {
        radius: paramFloat(ctx, "radius", 0.3),
        height: paramFloat(ctx, "height", 1),
        segments: paramInt(ctx, "segments", 16),
        caps: paramBool(ctx, "caps", true),
      },
      ctx.budgets
    );
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const gridNode: StudioGeometryNodeDefinition = {
  type: "mesh-grid",
  label: "격자 평면",
  summary: "XY 평면에 놓인 격자(법선 +Z). 압출·불리언의 프로파일 입력으로 씁니다.",
  inputs: [],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [
    { key: "sizeX", label: "가로", kind: "float", defaultValue: 1, min: 0.001, max: 1000 },
    { key: "sizeY", label: "세로", kind: "float", defaultValue: 1, min: 0.001, max: 1000 },
    { key: "segmentsX", label: "가로 분할", kind: "int", defaultValue: 1, min: 1, max: 256 },
    { key: "segmentsY", label: "세로 분할", kind: "int", defaultValue: 1, min: 1, max: 256 },
  ],
  evaluate: (ctx) => {
    const built = studioGeometryGrid(
      {
        sizeX: paramFloat(ctx, "sizeX", 1),
        sizeY: paramFloat(ctx, "sizeY", 1),
        segmentsX: paramInt(ctx, "segmentsX", 1),
        segmentsY: paramInt(ctx, "segmentsY", 1),
      },
      ctx.budgets
    );
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const transformNode: StudioGeometryNodeDefinition = {
  type: "transform",
  label: "트랜스폼",
  summary: "이동·회전(XYZ 오일러, 도)·스케일. 이동은 벡터 소켓으로 덮어쓸 수 있습니다.",
  inputs: [
    socket("geometry", "지오메트리", "geometry"),
    socket("translation", "이동", "vector", true),
  ],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [
    { key: "translateX", label: "이동 X", kind: "float", defaultValue: 0 },
    { key: "translateY", label: "이동 Y", kind: "float", defaultValue: 0 },
    { key: "translateZ", label: "이동 Z", kind: "float", defaultValue: 0 },
    { key: "rotateX", label: "회전 X(도)", kind: "float", defaultValue: 0 },
    { key: "rotateY", label: "회전 Y(도)", kind: "float", defaultValue: 0 },
    { key: "rotateZ", label: "회전 Z(도)", kind: "float", defaultValue: 0 },
    { key: "scaleX", label: "스케일 X", kind: "float", defaultValue: 1 },
    { key: "scaleY", label: "스케일 Y", kind: "float", defaultValue: 1 },
    { key: "scaleZ", label: "스케일 Z", kind: "float", defaultValue: 1 },
  ],
  evaluate: (ctx) => {
    const mesh = requireMesh(ctx, "geometry");
    if (!mesh.ok) return mesh;
    const translate = inputVector(ctx, "translation", [
      paramFloat(ctx, "translateX", 0),
      paramFloat(ctx, "translateY", 0),
      paramFloat(ctx, "translateZ", 0),
    ]);
    const built = studioGeometryTransform(
      mesh.value,
      {
        translate,
        rotate: [
          paramFloat(ctx, "rotateX", 0) * DEGREES_TO_RADIANS,
          paramFloat(ctx, "rotateY", 0) * DEGREES_TO_RADIANS,
          paramFloat(ctx, "rotateZ", 0) * DEGREES_TO_RADIANS,
        ],
        scale: [
          paramFloat(ctx, "scaleX", 1),
          paramFloat(ctx, "scaleY", 1),
          paramFloat(ctx, "scaleZ", 1),
        ],
      },
      ctx.budgets
    );
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const joinNode: StudioGeometryNodeDefinition = {
  type: "join",
  label: "합치기",
  summary: "두 지오메트리를 하나로 병합합니다(불리언이 아니라 단순 결합).",
  inputs: [socket("a", "A", "geometry"), socket("b", "B", "geometry", true)],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [],
  evaluate: (ctx) => {
    const a = requireMesh(ctx, "a");
    if (!a.ok) return a;
    const bValue = ctx.inputs.b;
    const meshes: StudioGeometryMesh[] = [a.value];
    if (bValue) {
      if (bValue.kind !== "geometry") {
        return studioGeometryFail("input-type-mismatch", '입력 "b" 는 지오메트리여야 합니다.');
      }
      meshes.push(bValue.mesh);
    }
    const built = studioGeometryJoin(meshes, ctx.budgets);
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const subdivideNode: StudioGeometryNodeDefinition = {
  type: "subdivide",
  label: "세분화(선형)",
  summary: "삼각형을 중점으로 4등분합니다. 곡면 스무딩이 아니라 각진 채로 조밀해집니다.",
  inputs: [socket("geometry", "지오메트리", "geometry"), socket("iterations", "반복", "int", true)],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [
    {
      key: "iterations",
      label: "반복",
      kind: "int",
      defaultValue: 1,
      min: 0,
      max: STUDIO_GEOMETRY_MAX_SUBDIVIDE_ITERATIONS,
    },
  ],
  evaluate: (ctx) => {
    const mesh = requireMesh(ctx, "geometry");
    if (!mesh.ok) return mesh;
    const iterations = inputInt(ctx, "iterations", paramInt(ctx, "iterations", 1));
    const built = studioGeometrySubdivide(mesh.value, iterations, ctx.budgets);
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const extrudeNode: StudioGeometryNodeDefinition = {
  type: "extrude",
  label: "압출(솔리디파이)",
  summary: "정점 법선 방향으로 두께를 줍니다. 열린 면은 측면 벽이 생겨 닫힌 입체가 됩니다.",
  inputs: [
    socket("geometry", "지오메트리", "geometry"),
    socket("distance", "거리", "float", true),
    socket("cap", "원면 유지", "bool", true),
  ],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [
    { key: "distance", label: "거리", kind: "float", defaultValue: 0.1 },
    { key: "capOriginal", label: "원면 유지", kind: "bool", defaultValue: true },
  ],
  evaluate: (ctx) => {
    const mesh = requireMesh(ctx, "geometry");
    if (!mesh.ok) return mesh;
    const built = studioGeometryExtrude(
      mesh.value,
      {
        distance: inputFloat(ctx, "distance", paramFloat(ctx, "distance", 0.1)),
        capOriginal: inputBool(ctx, "cap", paramBool(ctx, "capOriginal", true)),
      },
      ctx.budgets
    );
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const distributeNode: StudioGeometryNodeDefinition = {
  type: "distribute-points-on-faces",
  label: "면에 포인트 뿌리기",
  summary: "면적 가중 시드 샘플링. 최소 간격을 보장하는 푸아송 디스크가 아닙니다.",
  inputs: [socket("geometry", "지오메트리", "geometry")],
  outputs: [socket("points", "포인트", "points")],
  params: [
    { key: "count", label: "개수", kind: "int", defaultValue: 32, min: 1, max: 100_000 },
    { key: "seed", label: "시드", kind: "int", defaultValue: 0 },
  ],
  evaluate: (ctx) => {
    const mesh = requireMesh(ctx, "geometry");
    if (!mesh.ok) return mesh;
    const built = studioGeometryDistributePointsOnFaces(
      mesh.value,
      { count: paramInt(ctx, "count", 32), seed: paramInt(ctx, "seed", 0) },
      ctx.budgets
    );
    return built.ok
      ? studioGeometryOk({ points: { kind: "points", points: built.value } })
      : built;
  },
};

const instanceNode: StudioGeometryNodeDefinition = {
  type: "instance-on-points",
  label: "포인트에 인스턴스",
  summary: "포인트마다 인스턴스 메시를 복제합니다(예산 상한 1024개).",
  inputs: [socket("instance", "인스턴스", "geometry"), socket("points", "포인트", "points")],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [
    { key: "seed", label: "시드", kind: "int", defaultValue: 0 },
    { key: "scale", label: "스케일", kind: "float", defaultValue: 1, min: 0.001, max: 100 },
    { key: "scaleJitter", label: "스케일 지터", kind: "float", defaultValue: 0, min: 0, max: 0.99 },
    { key: "randomRotation", label: "무작위 회전", kind: "bool", defaultValue: false },
  ],
  evaluate: (ctx) => {
    const instance = requireMesh(ctx, "instance");
    if (!instance.ok) return instance;
    const points = requirePoints(ctx, "points");
    if (!points.ok) return points;
    const built = studioGeometryInstanceOnPoints(
      instance.value,
      points.value,
      {
        seed: paramInt(ctx, "seed", 0),
        scale: paramFloat(ctx, "scale", 1),
        scaleJitter: paramFloat(ctx, "scaleJitter", 0),
        randomRotation: paramBool(ctx, "randomRotation", false),
      },
      ctx.budgets
    );
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const booleanNode: StudioGeometryNodeDefinition = {
  type: "mesh-boolean",
  label: "불리언(평면)",
  summary:
    "같은 평면 위 두 프로파일을 결합합니다. 임의 3D CSG 가 아니며 비평면 입력은 거부합니다.",
  inputs: [socket("a", "A", "geometry"), socket("b", "B", "geometry")],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [
    {
      key: "op",
      label: "연산",
      kind: "enum",
      defaultValue: "union",
      options: STUDIO_GEOMETRY_BOOLEAN_OPS.map((value) => ({ value, label: value })),
    },
  ],
  evaluate: (ctx) => {
    const a = requireMesh(ctx, "a");
    if (!a.ok) return a;
    const b = requireMesh(ctx, "b");
    if (!b.ok) return b;
    const rawOp = paramString(ctx, "op", "union");
    if (!isStudioGeometryBooleanOp(rawOp)) {
      return studioGeometryFail("invalid-parameter", `알 수 없는 불리언 연산 "${rawOp}"`);
    }
    const built = studioGeometryPlanarBoolean(a.value, b.value, rawOp, {
      backend: ctx.booleanBackend,
      budgets: ctx.budgets,
    });
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const vectorNode: StudioGeometryNodeDefinition = {
  type: "value-vector",
  label: "벡터 값",
  summary: "상수 벡터. 이동·노이즈 좌표 입력으로 씁니다.",
  inputs: [],
  outputs: [socket("vector", "벡터", "vector")],
  params: [
    { key: "x", label: "X", kind: "float", defaultValue: 0 },
    { key: "y", label: "Y", kind: "float", defaultValue: 0 },
    { key: "z", label: "Z", kind: "float", defaultValue: 0 },
  ],
  evaluate: (ctx) =>
    studioGeometryOk({
      vector: {
        kind: "vector",
        value: [paramFloat(ctx, "x", 0), paramFloat(ctx, "y", 0), paramFloat(ctx, "z", 0)],
      },
    }),
};

const noiseNode: StudioGeometryNodeDefinition = {
  type: "noise-value",
  label: "노이즈 값",
  summary: "시드 프랙탈 값 노이즈(옥타브 1~5). 좌표 벡터를 받아 [0,1) 실수를 냅니다.",
  inputs: [socket("position", "좌표", "vector", true)],
  outputs: [socket("value", "값", "float")],
  params: [
    { key: "seed", label: "시드", kind: "int", defaultValue: 0 },
    { key: "scale", label: "스케일", kind: "float", defaultValue: 1 },
    { key: "octaves", label: "옥타브", kind: "int", defaultValue: 3, min: 1, max: 5 },
  ],
  evaluate: (ctx) => {
    const [x, y, z] = inputVector(ctx, "position", [0, 0, 0]);
    const value = studioGeometryFractalNoise3(
      x,
      y,
      z,
      paramInt(ctx, "seed", 0),
      paramInt(ctx, "octaves", 3),
      paramFloat(ctx, "scale", 1)
    );
    return studioGeometryOk({ value: { kind: "float", value } });
  },
};

const randomNode: StudioGeometryNodeDefinition = {
  type: "random-value",
  label: "난수 값",
  summary: "시드에서 뽑은 [min,max) 실수. 같은 시드는 항상 같은 값입니다.",
  inputs: [],
  outputs: [socket("value", "값", "float")],
  params: [
    { key: "seed", label: "시드", kind: "int", defaultValue: 0 },
    { key: "min", label: "최소", kind: "float", defaultValue: 0 },
    { key: "max", label: "최대", kind: "float", defaultValue: 1 },
  ],
  evaluate: (ctx) => {
    const random = createStudioGeometryRandom(paramInt(ctx, "seed", 0));
    const value = random.nextRange(paramFloat(ctx, "min", 0), paramFloat(ctx, "max", 1));
    return studioGeometryOk({ value: { kind: "float", value } });
  },
};

const attributeMathNode: StudioGeometryNodeDefinition = {
  type: "attribute-math",
  label: "속성 연산",
  summary: "point 도메인 위치 속성에 벡터 산술을 적용합니다(0 나눗셈은 0).",
  inputs: [socket("geometry", "지오메트리", "geometry"), socket("b", "B", "vector", true)],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [
    {
      key: "op",
      label: "연산",
      kind: "enum",
      defaultValue: "add",
      options: STUDIO_GEOMETRY_ATTRIBUTE_MATH_OPS.map((value) => ({ value, label: value })),
    },
    { key: "bx", label: "B.X", kind: "float", defaultValue: 0 },
    { key: "by", label: "B.Y", kind: "float", defaultValue: 0 },
    { key: "bz", label: "B.Z", kind: "float", defaultValue: 0 },
    { key: "cx", label: "C.X", kind: "float", defaultValue: 0 },
    { key: "cy", label: "C.Y", kind: "float", defaultValue: 0 },
    { key: "cz", label: "C.Z", kind: "float", defaultValue: 0 },
  ],
  evaluate: (ctx) => {
    const mesh = requireMesh(ctx, "geometry");
    if (!mesh.ok) return mesh;
    const rawOp = paramString(ctx, "op", "add");
    if (!isStudioGeometryAttributeMathOp(rawOp)) {
      return studioGeometryFail("invalid-parameter", `알 수 없는 속성 연산 "${rawOp}"`);
    }
    if (rawOp === "dot" || rawOp === "length") {
      return studioGeometryFail(
        "unsupported-operation",
        `${rawOp} 은 스칼라를 만들어 위치 속성으로 되돌릴 수 없습니다.`
      );
    }
    const b = inputVector(ctx, "b", [
      paramFloat(ctx, "bx", 0),
      paramFloat(ctx, "by", 0),
      paramFloat(ctx, "bz", 0),
    ]);
    const c: StudioGeometryVec3 = [
      paramFloat(ctx, "cx", 0),
      paramFloat(ctx, "cy", 0),
      paramFloat(ctx, "cz", 0),
    ];
    const computed = studioGeometryAttributeMath({
      a: studioGeometryPositionAttribute(mesh.value),
      b,
      c,
      op: rawOp,
    });
    if (!computed.ok) return computed;
    const built = studioGeometryWithPositions(mesh.value, computed.value, ctx.budgets);
    return built.ok ? studioGeometryOk(geometryOut(built.value)) : built;
  },
};

const outputNode: StudioGeometryNodeDefinition = {
  type: "output",
  label: "출력",
  summary: "그래프의 결과를 읽어가는 종단 노드입니다.",
  inputs: [socket("geometry", "지오메트리", "geometry")],
  outputs: [socket("geometry", "지오메트리", "geometry")],
  params: [],
  evaluate: (ctx) => {
    const mesh = requireMesh(ctx, "geometry");
    if (!mesh.ok) return mesh;
    return studioGeometryOk(geometryOut(mesh.value));
  },
};

export const STUDIO_GEOMETRY_NODE_DEFINITIONS: readonly StudioGeometryNodeDefinition[] = [
  cubeNode,
  sphereNode,
  cylinderNode,
  gridNode,
  transformNode,
  joinNode,
  subdivideNode,
  extrudeNode,
  distributeNode,
  instanceNode,
  booleanNode,
  vectorNode,
  noiseNode,
  randomNode,
  attributeMathNode,
  outputNode,
];

export const studioGeometryDefaultNodeRegistry: StudioGeometryNodeRegistry =
  createStudioGeometryNodeRegistry(STUDIO_GEOMETRY_NODE_DEFINITIONS);

/** 노드 타입의 파라미터 기본값 맵 — UI 가 새 노드를 만들 때, 파서가 결측을 채울 때 쓴다. */
export function studioGeometryDefaultParams(
  definition: StudioGeometryNodeDefinition
): Record<string, StudioGeometryParamValue> {
  const params: Record<string, StudioGeometryParamValue> = {};
  for (const spec of definition.params) params[spec.key] = spec.defaultValue;
  return params;
}

/** 파라미터 1개를 스키마 범위로 정규화. 타입이 안 맞으면 기본값으로 되돌린다. */
export function studioGeometryNormalizeParam(
  spec: StudioGeometryParamSpec,
  raw: unknown
): StudioGeometryParamValue {
  if (spec.kind === "bool") return typeof raw === "boolean" ? raw : spec.defaultValue;
  if (spec.kind === "enum") {
    if (typeof raw !== "string") return spec.defaultValue;
    return spec.options?.some((option) => option.value === raw) ? raw : spec.defaultValue;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) return spec.defaultValue;
  const value = spec.kind === "int" ? Math.trunc(raw) : raw;
  const min = spec.min ?? -STUDIO_GEOMETRY_PARAM_LIMIT;
  const max = spec.max ?? STUDIO_GEOMETRY_PARAM_LIMIT;
  return studioGeometryClamp(value, min, max);
}

/** 스키마에 min/max 가 없을 때의 절대 상한 — 직렬화 문서가 무한대를 못 싣게 한다. */
export const STUDIO_GEOMETRY_PARAM_LIMIT = 1_000_000;

/** 진단용 — 메시 정점 수를 노출(패널 상태 표시). */
export function studioGeometryValueSummary(value: StudioGeometryValue): string {
  switch (value.kind) {
    case "geometry":
      return `지오메트리 ${studioGeometryVertexCount(value.mesh)}정점`;
    case "points":
      return `포인트 ${value.points.positions.length / 3}개`;
    case "vector":
      return `벡터 (${value.value.join(", ")})`;
    case "bool":
      return value.value ? "참" : "거짓";
    default:
      return String(value.value);
  }
}
