/**
 * 생성형 캐릭터 메시의 **엔진 비의존 지오메트리 커널**.
 *
 * three.js 를 쓰지 않는다. 스튜디오의 VRM 저작 파이프라인(studio-vrm-export-plan)이 순수
 * 데이터 스냅샷을 받으므로, 메시도 같은 층위에서 순수 함수로 만들면 `node` 환경 유닛 테스트가
 * 그대로 붙는다 — 캔버스도 GPU 도 필요 없다.
 *
 * 여기 있는 것은 전부 결정론적이다(난수·시간·전역 상태 없음). 같은 파라미터면 같은 정점이 나온다.
 */

export type MeshVec3 = readonly [number, number, number];
export type MeshVec2 = readonly [number, number];

/** 정점 하나의 스킨 바인딩. 최대 4개 관절, 가중치 합은 빌더가 1로 정규화한다. */
export type MeshSkinBinding = readonly (readonly [joint: number, weight: number])[];

/** UV 아틀라스 영역. [u0, v0, u1, v1]. */
export type MeshUvRect = readonly [number, number, number, number];

export const FULL_UV_RECT: MeshUvRect = [0, 0, 1, 1];

export function meshLerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function meshClamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSkin(binding: MeshSkinBinding): {
  readonly joints: readonly [number, number, number, number];
  readonly weights: readonly [number, number, number, number];
} {
  const entries = binding
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
    .slice(0, 4);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const joints: number[] = [0, 0, 0, 0];
  const weights: number[] = [0, 0, 0, 0];
  if (entries.length === 0 || total <= 0) {
    weights[0] = 1;
  } else {
    entries.forEach(([joint, weight], index) => {
      joints[index] = joint;
      weights[index] = weight / total;
    });
  }
  return {
    joints: joints as unknown as readonly [number, number, number, number],
    weights: weights as unknown as readonly [number, number, number, number],
  };
}

/**
 * 정점/인덱스를 모으는 누산기. 노멀은 마지막에 한 번에 계산한다
 * ({@link SurfaceBuilder.build}) — 이음매(seam)에서 정점이 갈라져도 위치로 용접해
 * 매끄럽게 이어지도록.
 */
export class SurfaceBuilder {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private readonly joints: number[] = [];
  private readonly weights: number[] = [];
  private readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  vertex(position: MeshVec3, uv: MeshVec2, skin: MeshSkinBinding): number {
    const index = this.vertexCount;
    this.positions.push(position[0], position[1], position[2]);
    this.uvs.push(uv[0], uv[1]);
    const resolved = normalizeSkin(skin);
    this.joints.push(...resolved.joints);
    this.weights.push(...resolved.weights);
    return index;
  }

  triangle(a: number, b: number, c: number): void {
    if (a === b || b === c || a === c) return;
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }

  /**
   * 이미 쌓인 모든 정점 위치를 옮긴다. `build()` **전에** 불러야 한다 — 스무스 노멀은
   * 빌드 시점의 위치에서 계산되므로, 여기서 옮기면 노멀도 함께 따라온다.
   *
   * 비균등 스케일처럼 파츠 TRS 로는 표현할 수 없는 변환(회전과 교환되지 않는다)을
   * 저작이 끝난 뒤 한 번에 적용하려고 둔다.
   */
  transformPositions(map: (point: MeshVec3) => MeshVec3): void {
    for (let index = 0; index < this.positions.length; index += 3) {
      const moved = map([this.positions[index], this.positions[index + 1], this.positions[index + 2]]);
      this.positions[index] = moved[0];
      this.positions[index + 1] = moved[1];
      this.positions[index + 2] = moved[2];
    }
  }

  /** 이미 쌓인 삼각형 중 [from, to) 구간의 감김 방향을 뒤집는다. */
  flipWindingFrom(firstIndexOffset: number): void {
    for (let offset = firstIndexOffset; offset + 2 < this.indices.length; offset += 3) {
      const swap = this.indices[offset + 1];
      this.indices[offset + 1] = this.indices[offset + 2];
      this.indices[offset + 2] = swap;
    }
  }

  get indexCursor(): number {
    return this.indices.length;
  }

  positionAt(index: number): MeshVec3 {
    return [
      this.positions[index * 3],
      this.positions[index * 3 + 1],
      this.positions[index * 3 + 2],
    ];
  }

  build(): {
    readonly positions: readonly number[];
    readonly normals: readonly number[];
    readonly uvs: readonly number[];
    readonly joints: readonly number[];
    readonly weights: readonly number[];
    readonly indices: readonly number[];
  } {
    return {
      positions: this.positions,
      normals: computeWeldedSmoothNormals(this.positions, this.indices),
      uvs: this.uvs,
      joints: this.joints,
      weights: this.weights,
      indices: this.indices,
    };
  }
}

/**
 * 면 노멀을 정점에 누적해 스무스 노멀을 만든다. **같은 좌표의 정점은 하나로 용접**해서
 * 누적하므로 UV 이음매에서 갈라 놓은 중복 정점도 한 덩어리처럼 매끄럽게 이어진다.
 *
 * 용접 키는 1e-5 m 격자로 양자화한 좌표다 — 부동소수 오차에 흔들리지 않으면서 결정론적이다.
 */
export function computeWeldedSmoothNormals(
  positions: readonly number[],
  indices: readonly number[],
): number[] {
  const vertexCount = positions.length / 3;
  const weldOf = new Int32Array(vertexCount);
  const weldNormals: number[] = [];
  const keyToWeld = new Map<string, number>();

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const key = `${quantize(positions[vertex * 3])},${quantize(positions[vertex * 3 + 1])},${quantize(positions[vertex * 3 + 2])}`;
    let weld = keyToWeld.get(key);
    if (weld === undefined) {
      weld = weldNormals.length / 3;
      keyToWeld.set(key, weld);
      weldNormals.push(0, 0, 0);
    }
    weldOf[vertex] = weld;
  }

  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    const a = indices[offset];
    const b = indices[offset + 1];
    const c = indices[offset + 2];
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax;
    const uy = positions[b * 3 + 1] - ay;
    const uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax;
    const vy = positions[c * 3 + 1] - ay;
    const vz = positions[c * 3 + 2] - az;
    // 정규화하지 않은 외적 = 면적 가중 노멀. 큰 면이 더 크게 기여해 자연스럽다.
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const vertex of [a, b, c]) {
      const weld = weldOf[vertex] * 3;
      weldNormals[weld] += nx;
      weldNormals[weld + 1] += ny;
      weldNormals[weld + 2] += nz;
    }
  }

  const normals: number[] = [];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const weld = weldOf[vertex] * 3;
    const nx = weldNormals[weld];
    const ny = weldNormals[weld + 1];
    const nz = weldNormals[weld + 2];
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) {
      normals.push(0, 1, 0);
    } else {
      normals.push(nx / length, ny / length, nz / length);
    }
  }
  return normals;
}

function quantize(value: number): number {
  // `+0` 을 더해 -0 을 0 으로 접는다(키 문자열이 갈라지지 않도록).
  return Math.round(value * 100_000) + 0;
}

/* -------------------------------------------------------------------------- */
/* 로프트(단면 스윕)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 스윕할 단면 하나. `u`/`v` 는 **이미 반지름이 곱해진** 기저 벡터다.
 * 단면 위의 점 = `center + u·cos̃θ + v·siñθ` (초타원 지수 `exponent` 적용).
 */
export type LoftRing = {
  readonly center: MeshVec3;
  readonly u: MeshVec3;
  readonly v: MeshVec3;
  readonly skin: MeshSkinBinding;
  /** UV 의 세로 좌표(0~1). */
  readonly texV: number;
  /** 초타원 지수. 2 = 정타원, 클수록 모서리가 각지고 사람 몸통에 가깝다. */
  readonly exponent?: number;
};

/** 축 정렬 단면을 만드는 헬퍼 — Y 를 축으로 하는 몸통/다리용. */
export function verticalRing(
  center: MeshVec3,
  radiusX: number,
  radiusZ: number,
  skin: MeshSkinBinding,
  texV: number,
  exponent?: number,
): LoftRing {
  return { center, u: [radiusX, 0, 0], v: [0, 0, radiusZ], skin, texV, exponent };
}

/** X 를 축으로 하는 팔/손용 단면. */
export function lateralRing(
  center: MeshVec3,
  radiusY: number,
  radiusZ: number,
  skin: MeshSkinBinding,
  texV: number,
  exponent?: number,
): LoftRing {
  return { center, u: [0, radiusY, 0], v: [0, 0, radiusZ], skin, texV, exponent };
}

/** Z 를 축으로 하는 발용 단면. */
export function forwardRing(
  center: MeshVec3,
  radiusX: number,
  radiusY: number,
  skin: MeshSkinBinding,
  texV: number,
  exponent?: number,
): LoftRing {
  return { center, u: [radiusX, 0, 0], v: [0, radiusY, 0], skin, texV, exponent };
}

function superCos(angle: number, exponent: number): number {
  const value = Math.cos(angle);
  if (exponent === 2) return value;
  return Math.sign(value) * Math.abs(value) ** (2 / exponent);
}

function superSin(angle: number, exponent: number): number {
  const value = Math.sin(angle);
  if (exponent === 2) return value;
  return Math.sign(value) * Math.abs(value) ** (2 / exponent);
}

export function loftRingPoint(ring: LoftRing, angle: number): MeshVec3 {
  const exponent = ring.exponent ?? 2;
  const c = superCos(angle, exponent);
  const s = superSin(angle, exponent);
  return [
    ring.center[0] + ring.u[0] * c + ring.v[0] * s,
    ring.center[1] + ring.u[1] * c + ring.v[1] * s,
    ring.center[2] + ring.u[2] * c + ring.v[2] * s,
  ];
}

export type LoftOptions = {
  readonly segments: number;
  readonly uvRect?: MeshUvRect;
  /** 시작/끝 단면을 중심점으로 막는다(팔다리 끝, 몸통 위아래). */
  readonly capStart?: boolean;
  readonly capEnd?: boolean;
};

/**
 * 단면 열을 이어 붙여 관을 만든다.
 *
 * 감김 방향은 자동으로 바깥쪽으로 맞춘다 — 첫 삼각형의 면 노멀이 단면 중심에서 바깥으로
 * 향하는지 보고 아니면 이 로프트가 쌓은 삼각형 전체를 뒤집는다. 몸통·팔·다리·발이
 * 서로 다른 축을 쓰기 때문에 기저의 손잡이(handedness)를 호출부가 신경 쓰지 않게 하려는 것.
 */
export function addLoft(
  builder: SurfaceBuilder,
  rings: readonly LoftRing[],
  options: LoftOptions,
): void {
  if (rings.length < 2) return;
  const segments = Math.max(3, Math.floor(options.segments));
  const [u0, v0, u1, v1] = options.uvRect ?? FULL_UV_RECT;
  const indexStart = builder.indexCursor;

  const grid: number[][] = rings.map((ring) => {
    const row: number[] = [];
    // 마지막 열은 첫 열과 같은 좌표를 갖는 이음매 정점이다. UV 가 0→1 로 닫히도록 복제하고,
    // 노멀은 위치 용접이 알아서 이어 준다.
    for (let column = 0; column <= segments; column += 1) {
      const angle = (column / segments) * Math.PI * 2;
      row.push(
        builder.vertex(
          loftRingPoint(ring, angle),
          [meshLerp(u0, u1, column / segments), meshLerp(v0, v1, ring.texV)],
          ring.skin,
        ),
      );
    }
    return row;
  });

  for (let row = 0; row + 1 < rings.length; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      builder.quad(
        grid[row][column],
        grid[row][column + 1],
        grid[row + 1][column + 1],
        grid[row + 1][column],
      );
    }
  }

  if (options.capStart) addCap(builder, rings[0], grid[0], segments, [u0, v0, u1, v1], false);
  if (options.capEnd) {
    const last = rings.length - 1;
    addCap(builder, rings[last], grid[last], segments, [u0, v0, u1, v1], true);
  }

  orientOutward(builder, indexStart, rings);
}

function addCap(
  builder: SurfaceBuilder,
  ring: LoftRing,
  row: readonly number[],
  segments: number,
  uvRect: MeshUvRect,
  reverse: boolean,
): void {
  const [u0, v0, u1, v1] = uvRect;
  const center = builder.vertex(
    ring.center,
    [meshLerp(u0, u1, 0.5), meshLerp(v0, v1, ring.texV)],
    ring.skin,
  );
  for (let column = 0; column < segments; column += 1) {
    const a = row[column];
    const b = row[column + 1];
    if (reverse) builder.triangle(center, a, b);
    else builder.triangle(center, b, a);
  }
}

/**
 * 로프트가 쌓은 삼각형들이 바깥을 보게 맞춘다. 표본은 **첫 두 단면의 첫 사각형**이고,
 * 기준 방향은 그 사각형의 중심에서 두 단면 중심을 이은 축까지의 수직 성분이다.
 */
function orientOutward(
  builder: SurfaceBuilder,
  indexStart: number,
  rings: readonly LoftRing[],
): void {
  const sampleAngle = 0;
  const a = loftRingPoint(rings[0], sampleAngle);
  const b = loftRingPoint(rings[0], (Math.PI * 2) / 8);
  const c = loftRingPoint(rings[1], sampleAngle);
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const outX = a[0] - rings[0].center[0];
  const outY = a[1] - rings[0].center[1];
  const outZ = a[2] - rings[0].center[2];
  // quad(grid[0][0], grid[0][1], grid[1][1], grid[1][0]) 의 첫 삼각형은 (a, b, c) 와 같은 방향이다.
  if (nx * outX + ny * outY + nz * outZ < 0) builder.flipWindingFrom(indexStart);
}

/* -------------------------------------------------------------------------- */
/* 변환                                                                        */
/* -------------------------------------------------------------------------- */

/** 3×3 회전 행렬(행 우선). */
export type MeshMat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * three.js `Euler` 의 기본 순서 'XYZ' 와 **같은** 회전 행렬을 만든다.
 * 아바타 조형 헤어 파츠가 three 렌더러와 동일한 자세로 구워지려면 순서가 정확히 맞아야 한다.
 */
export function eulerXyzMatrix(x: number, y: number, z: number): MeshMat3 {
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  return [
    c * e, -c * f, d,
    af + be * d, ae - bf * d, -b * c,
    bf - ae * d, be + af * d, a * c,
  ];
}

/** `p' = R·(S·p) + T` — three.js 의 position/rotation/scale 합성과 같은 순서. */
export function applyTrs(
  point: MeshVec3,
  translation: MeshVec3,
  rotation: MeshMat3,
  scale: MeshVec3,
): MeshVec3 {
  const x = point[0] * scale[0];
  const y = point[1] * scale[1];
  const z = point[2] * scale[2];
  return [
    rotation[0] * x + rotation[1] * y + rotation[2] * z + translation[0],
    rotation[3] * x + rotation[4] * y + rotation[5] * z + translation[1],
    rotation[6] * x + rotation[7] * y + rotation[8] * z + translation[2],
  ];
}

/** 회전 행렬이 좌우 반전을 포함하는지(음의 행렬식) — 감김 방향을 뒤집어야 하는지 판단용. */
export function isMirroredScale(scale: MeshVec3): boolean {
  return scale[0] * scale[1] * scale[2] < 0;
}
