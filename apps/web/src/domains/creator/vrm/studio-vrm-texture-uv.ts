/**
 * VRM 텍스처 페인팅 — 레이 히트(삼각형 + 무게중심좌표) → UV → 텍셀 좌표 해석 코어.
 *
 * three/@pixiv 의존이 전혀 없는 순수 수학 모듈이다. 뷰포트(StudioVrmPoser)는 R3F 이벤트에서
 * 얻은 `intersection.barycoord`(THREE.Vector3)와 삼각형의 UV 3개를 그대로 넘기면 되고,
 * 헤드리스 테스트는 같은 함수를 GPU 없이 검증한다.
 *
 * ── V 축 규약(가장 흔한 사고 지점) ─────────────────────────────────────────
 * glTF 2.0 은 TEXCOORD 의 원점을 이미지 **좌상단**으로 정의한다(u→오른쪽, v→아래쪽).
 * three 의 GLTFLoader 는 그래서 glTF 출처 텍스처에 `texture.flipY = false` 를 설정한다.
 * 즉 VRM 모델의 UV 는 디코딩된 이미지의 픽셀 좌표계(= CanvasRenderingContext2D 의 좌표계,
 * ImageData 0행 = 맨 윗줄)와 **완전히 동일**하다 → 변환/뒤집기가 필요 없다.
 *
 * 그래서 이 코어의 기본값은 `flipV: false` 이고, 텍셀 좌표는 항상
 *   x = u * width,  y = v * height  (y 는 아래로 증가, (0,0) = 좌상단 텍셀)
 * 이다. 페인트 백엔드(캔버스/ImageData/WebGL 텍스처 업로드)도 같은 좌표계를 쓴다.
 *
 * `flipV: true` 는 예외 경로 전용이다 — three 의 `Texture`/`CanvasTexture` 기본값은
 * `flipY = true` 라서, 우리가 만든 페인트 캔버스를 그대로 CanvasTexture 로 감싸면 V 가
 * 뒤집힌다. **통합 규칙: 페인트 CanvasTexture 에는 반드시 `flipY = false` 를 설정한다.**
 * 그렇게 하면 앱 전체에서 flipV 를 켤 일이 없다(모델 텍스처와 페인트 레이어가 같은 규약).
 */

/** 텍스처 한 변의 상한 — VRoid 계열 4K 아틀라스까지 수용하되 그 이상은 거부한다. */
export const STUDIO_VRM_TEXTURE_MAX_DIMENSION = 4096;

/** RGBA 버퍼 상한(= 4096², 64 MiB). 초과 크기는 페인트 대상이 아니다. */
export const STUDIO_VRM_TEXTURE_MAX_TEXELS =
  STUDIO_VRM_TEXTURE_MAX_DIMENSION * STUDIO_VRM_TEXTURE_MAX_DIMENSION;

/** three 의 RepeatWrapping / ClampToEdgeWrapping / MirroredRepeatWrapping 에 대응한다. */
export type StudioVrmTextureWrapMode = "clamp" | "repeat" | "mirror";

export interface StudioVrmTextureSize {
  readonly width: number;
  readonly height: number;
}

/** 정수 텍셀 사각형. width/height 가 0 이면 빈 영역이다. */
export interface StudioVrmTextureRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioVrmUvPoint {
  readonly u: number;
  readonly v: number;
}

/** 연속 텍셀 좌표(픽셀 단위 실수). 텍셀 (i, j) 의 중심은 (i + 0.5, j + 0.5). */
export interface StudioVrmTexelPoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioVrmTexelIndex {
  readonly x: number;
  readonly y: number;
  /** 텍셀 인덱스(바이트 오프셋 아님). RGBA 바이트 오프셋은 index * 4. */
  readonly index: number;
}

export interface StudioVrmBarycentric {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

export interface StudioVrmTriangleUv {
  readonly a: StudioVrmUvPoint;
  readonly b: StudioVrmUvPoint;
  readonly c: StudioVrmUvPoint;
}

export interface StudioVrmVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StudioVrmTriangleWorld {
  readonly a: StudioVrmVector3;
  readonly b: StudioVrmVector3;
  readonly c: StudioVrmVector3;
}

export interface StudioVrmTexelResolveOptions {
  readonly wrapU?: StudioVrmTextureWrapMode;
  readonly wrapV?: StudioVrmTextureWrapMode;
  /** true 면 V 를 뒤집는다. glTF/VRM 텍스처(flipY=false)에서는 항상 false 로 둔다. */
  readonly flipV?: boolean;
}

export interface StudioVrmTextureHit {
  readonly triangle: StudioVrmTriangleUv;
  /** THREE.Vector3(x/y/z) 또는 {a,b,c} 둘 다 받는다. */
  readonly barycentric: unknown;
}

export interface StudioVrmTextureHitResolution {
  readonly uv: StudioVrmUvPoint;
  readonly point: StudioVrmTexelPoint;
  readonly texel: StudioVrmTexelIndex;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return isFiniteNumber(value) ? value : null;
}

/** 렌더러가 준 크기가 실제 RGBA 버퍼로 다룰 수 있는 값인지 검사한다. */
export function isStudioVrmTextureSize(value: unknown): value is StudioVrmTextureSize {
  if (typeof value !== "object" || value === null) return false;
  const size = value as Record<string, unknown>;
  const width = size.width;
  const height = size.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return false;
  const w = width as number;
  const h = height as number;
  if (w <= 0 || h <= 0) return false;
  if (w > STUDIO_VRM_TEXTURE_MAX_DIMENSION || h > STUDIO_VRM_TEXTURE_MAX_DIMENSION) return false;
  return w * h <= STUDIO_VRM_TEXTURE_MAX_TEXELS;
}

/**
 * 무게중심좌표를 정규화한다. three 의 `Triangle.getBarycoord` 는 (a,b,c) 가중치를
 * Vector3 의 (x,y,z) 로 돌려주므로 `intersection.barycoord` 를 그대로 넣을 수 있다.
 * 합이 1 이 아니면(부동소수 누적) 합으로 나눠 정규화하고, 합이 0 이거나 비유한이면 null.
 */
export function normalizeStudioVrmBarycentric(raw: unknown): StudioVrmBarycentric | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const a = readNumber(source, "a") ?? readNumber(source, "x");
  const b = readNumber(source, "b") ?? readNumber(source, "y");
  const c = readNumber(source, "c") ?? readNumber(source, "z");
  if (a === null || b === null || c === null) return null;
  const sum = a + b + c;
  if (!Number.isFinite(sum) || Math.abs(sum) < 1e-9) return null;
  return { a: a / sum, b: b / sum, c: c / sum };
}

function isUvPoint(value: unknown): value is StudioVrmUvPoint {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.u) && isFiniteNumber(point.v);
}

/** 삼각형 UV 를 무게중심좌표로 보간한다. */
export function resolveStudioVrmTriangleUv(
  triangle: StudioVrmTriangleUv,
  barycentric: unknown,
): StudioVrmUvPoint | null {
  if (!isUvPoint(triangle.a) || !isUvPoint(triangle.b) || !isUvPoint(triangle.c)) return null;
  const weights = normalizeStudioVrmBarycentric(barycentric);
  if (!weights) return null;
  const u = triangle.a.u * weights.a + triangle.b.u * weights.b + triangle.c.u * weights.c;
  const v = triangle.a.v * weights.a + triangle.b.v * weights.b + triangle.c.v * weights.c;
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  return { u, v };
}

function isVector3(value: unknown): value is StudioVrmVector3 {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.x) && isFiniteNumber(point.y) && isFiniteNumber(point.z);
}

/**
 * 3D 점의 무게중심좌표. three 의 `Triangle.getBarycoord` 와 동일한 수식·동일한 성분 순서라
 * `intersection.barycoord` 가 없는 경로(구버전/커스텀 픽커)에서도 같은 값을 얻는다.
 */
export function computeStudioVrmBarycentric(
  point: StudioVrmVector3,
  a: StudioVrmVector3,
  b: StudioVrmVector3,
  c: StudioVrmVector3,
): StudioVrmBarycentric | null {
  if (!isVector3(point) || !isVector3(a) || !isVector3(b) || !isVector3(c)) return null;
  const v0x = c.x - a.x;
  const v0y = c.y - a.y;
  const v0z = c.z - a.z;
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v1z = b.z - a.z;
  const v2x = point.x - a.x;
  const v2y = point.y - a.y;
  const v2z = point.z - a.z;

  const dot00 = v0x * v0x + v0y * v0y + v0z * v0z;
  const dot01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const dot02 = v0x * v2x + v0y * v2y + v0z * v2z;
  const dot11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const dot12 = v1x * v2x + v1y * v2y + v1z * v2z;

  const denominator = dot00 * dot11 - dot01 * dot01;
  if (!Number.isFinite(denominator) || denominator === 0) return null;

  const inverse = 1 / denominator;
  const u = (dot11 * dot02 - dot01 * dot12) * inverse;
  const v = (dot00 * dot12 - dot01 * dot02) * inverse;
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  return { a: 1 - u - v, b: v, c: u };
}

/** UV 한 성분을 래핑 규칙에 따라 [0, 1] 로 접는다(clamp 만 1 을 그대로 남긴다). */
export function wrapStudioVrmUv(value: number, mode: StudioVrmTextureWrapMode): number {
  if (!Number.isFinite(value)) return Number.NaN;
  if (mode === "clamp") return Math.min(1, Math.max(0, value));
  const whole = Math.floor(value);
  const fraction = value - whole;
  if (mode === "repeat") return fraction;
  // mirror: 홀수 타일에서 좌우(상하) 반전.
  const parity = ((whole % 2) + 2) % 2;
  return parity === 0 ? fraction : 1 - fraction;
}

/**
 * UV → 연속 텍셀 좌표. 반환값 x 는 [0, width], y 는 [0, height] 범위의 실수다
 * (clamp 모드에서 u=1 이면 정확히 width). 정수 텍셀은 `resolveStudioVrmTexelIndex`.
 *
 * 래핑 → flipV 순서로 적용한다. 샘플러가 UV 를 먼저 접고, flipY 는 업로드된 이미지의
 * 행 순서만 바꾸는 별개 단계이기 때문이다.
 */
export function resolveStudioVrmTexelPoint(
  uv: StudioVrmUvPoint,
  size: StudioVrmTextureSize,
  options: StudioVrmTexelResolveOptions = {},
): StudioVrmTexelPoint | null {
  if (!isUvPoint(uv) || !isStudioVrmTextureSize(size)) return null;
  const u = wrapStudioVrmUv(uv.u, options.wrapU ?? "repeat");
  const wrappedV = wrapStudioVrmUv(uv.v, options.wrapV ?? "repeat");
  if (!Number.isFinite(u) || !Number.isFinite(wrappedV)) return null;
  const v = options.flipV === true ? 1 - wrappedV : wrappedV;
  return { x: u * size.width, y: v * size.height };
}

function texelFromContinuous(value: number, extent: number): number {
  const index = Math.floor(value);
  if (index < 0) return 0;
  if (index >= extent) return extent - 1;
  return index;
}

/** UV → 정수 텍셀. 경계값(u=1 등)은 마지막 텍셀로 클램프된다. */
export function resolveStudioVrmTexelIndex(
  uv: StudioVrmUvPoint,
  size: StudioVrmTextureSize,
  options: StudioVrmTexelResolveOptions = {},
): StudioVrmTexelIndex | null {
  const point = resolveStudioVrmTexelPoint(uv, size, options);
  if (!point) return null;
  const x = texelFromContinuous(point.x, size.width);
  const y = texelFromContinuous(point.y, size.height);
  return { x, y, index: y * size.width + x };
}

/** 레이 히트 하나를 UV·연속좌표·정수 텍셀로 한 번에 푼다. */
export function resolveStudioVrmTextureHit(
  hit: StudioVrmTextureHit,
  size: StudioVrmTextureSize,
  options: StudioVrmTexelResolveOptions = {},
): StudioVrmTextureHitResolution | null {
  const uv = resolveStudioVrmTriangleUv(hit.triangle, hit.barycentric);
  if (!uv) return null;
  const point = resolveStudioVrmTexelPoint(uv, size, options);
  if (!point) return null;
  const texel = resolveStudioVrmTexelIndex(uv, size, options);
  if (!texel) return null;
  return { uv, point, texel };
}

/**
 * 이 삼각형에서 "월드 1 단위당 몇 텍셀인가". 브러시 크기를 화면이 아니라 모델 기준으로
 * 일정하게 유지하려면 `sizeTexels = 월드지름 × 이 밀도` 로 환산해야 한다.
 * UV 가 극단적으로 늘어난 면(밀도 0 에 가까움)에서는 null 을 돌려 호출측이 폴백하게 한다.
 */
export function estimateStudioVrmUvTexelDensity(
  triangleUv: StudioVrmTriangleUv,
  triangleWorld: StudioVrmTriangleWorld,
  size: StudioVrmTextureSize,
): number | null {
  if (!isStudioVrmTextureSize(size)) return null;
  if (!isUvPoint(triangleUv.a) || !isUvPoint(triangleUv.b) || !isUvPoint(triangleUv.c)) return null;
  if (!isVector3(triangleWorld.a) || !isVector3(triangleWorld.b) || !isVector3(triangleWorld.c)) {
    return null;
  }

  const uvArea =
    Math.abs(
      (triangleUv.b.u - triangleUv.a.u) * (triangleUv.c.v - triangleUv.a.v) -
        (triangleUv.c.u - triangleUv.a.u) * (triangleUv.b.v - triangleUv.a.v),
    ) / 2;

  const ex = triangleWorld.b.x - triangleWorld.a.x;
  const ey = triangleWorld.b.y - triangleWorld.a.y;
  const ez = triangleWorld.b.z - triangleWorld.a.z;
  const fx = triangleWorld.c.x - triangleWorld.a.x;
  const fy = triangleWorld.c.y - triangleWorld.a.y;
  const fz = triangleWorld.c.z - triangleWorld.a.z;
  const cx = ey * fz - ez * fy;
  const cy = ez * fx - ex * fz;
  const cz = ex * fy - ey * fx;
  const worldArea = Math.hypot(cx, cy, cz) / 2;

  if (!(uvArea > 0) || !(worldArea > 0)) return null;
  const density = Math.sqrt((uvArea * size.width * size.height) / worldArea);
  return Number.isFinite(density) && density > 0 ? density : null;
}
