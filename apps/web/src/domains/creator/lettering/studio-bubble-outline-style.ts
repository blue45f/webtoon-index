/**
 * Studio Bubble Outline Style — 말풍선 외곽선 손그림(러프/떨림) 스타일 순수 엔진.
 *
 * 클립스튜디오의 "말풍선 펜(손으로 그린 외곽선)" 질감을, 새 그리기 도구 없이 기존 실루엣
 * path(d)를 결정적으로 변형해 얻는다. 파이프라인:
 *   1) 실루엣 d → 폴리곤 샘플링(studio-bubble-custom-shape 의 sampleBubblePathDataToPolygon 재사용)
 *   2) 긴 선분 세분화(원본 절점은 그대로 보존 — 별 스파이크·꼬리 끝이 뭉개지지 않는다)
 *   3) 시드 PRNG(mulberry32, 시드=요소 id 해시)로 각 점을 미세 지터
 *   4) rough 는 직선 폴리라인 d, wobbly 는 중점 이차베지어 스무딩 d 로 방출
 *
 * 캔버스(Konva Path)와 SVG export 가 같은 d 문자열을 소비하므로 픽셀 패리티가 자동으로
 * 성립한다. 전부 순수·결정적 — 같은 (d, style, seedKey, strokeWidth) 입력이면 항상 같은
 * 출력(난수·시간·DOM 의존 없음, 핫패스 결정성 계약과 동일 원칙).
 *
 * BubbleEl.outlineStyle 은 선택 필드다 — undefined(기본)는 기존과 바이트 동일하게 렌더된다
 * (하위호환: 구 문서 렌더 불변).
 */
import { sampleBubblePathDataToPolygon } from "./studio-bubble-custom-shape";

export type BubbleOutlineStyle = "rough" | "wobbly";

/** 인스펙터 칩 카탈로그 — "smooth"는 저장하지 않는 기본값(필드 제거)이다. */
export const BUBBLE_OUTLINE_STYLE_OPTIONS: {
  id: BubbleOutlineStyle | "smooth";
  label: string;
  tip: string;
}[] = [
  { id: "smooth", label: "매끈", tip: "기본 벡터 외곽선 — 깔끔한 디지털 마감." },
  { id: "rough", label: "거친 펜", tip: "잉크 펜으로 눌러 그린 듯한 잔거침 외곽선." },
  { id: "wobbly", label: "손그림", tip: "손으로 천천히 그린 듯한 굽이치는 외곽선." },
];

/** 저장 문서의 outlineStyle 을 방어적으로 정규화한다(모르는 값 → undefined=매끈). */
export function normalizeBubbleOutlineStyle(raw: unknown): BubbleOutlineStyle | undefined {
  return raw === "rough" || raw === "wobbly" ? raw : undefined;
}

// ── 시드 PRNG (fnv-1a → mulberry32) ─────────────────────────────────────────

function fnv1aHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 스타일 파라미터 ──────────────────────────────────────────────────────────

interface OutlineStyleParams {
  /** 이보다 긴 선분은 이 간격으로 세분해 지터 절점을 늘린다(px). */
  segmentSpacing: number;
  /** 점당 최대 지터 반경(px) — 외곽선 두께에 비례하되 상·하한 클램프. */
  amplitude: (strokeWidth: number) => number;
  smooth: boolean;
}

const STYLE_PARAMS: Record<BubbleOutlineStyle, OutlineStyleParams> = {
  rough: {
    segmentSpacing: 7,
    amplitude: (strokeWidth) => clamp(0.9 + strokeWidth * 0.35, 1.1, 3.2),
    smooth: false,
  },
  wobbly: {
    segmentSpacing: 16,
    amplitude: (strokeWidth) => clamp(1.6 + strokeWidth * 0.55, 2.2, 5),
    smooth: true,
  },
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

const N = (value: number): string => (Math.round(value * 100) / 100).toString();

// ── 코어 파이프라인 ──────────────────────────────────────────────────────────

/** 원본 절점을 보존하며 긴 선분만 spacing 간격으로 세분한다(닫힌 폴리곤 가정). */
function subdivideClosedPolygon(points: readonly number[], spacing: number): number[] {
  const count = points.length / 2;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const ax = points[i * 2]!;
    const ay = points[i * 2 + 1]!;
    const next = (i + 1) % count;
    const bx = points[next * 2]!;
    const by = points[next * 2 + 1]!;
    out.push(ax, ay);
    const length = Math.hypot(bx - ax, by - ay);
    const extra = Math.floor(length / spacing);
    for (let k = 1; k <= extra; k++) {
      const t = k / (extra + 1);
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return out;
}

function jitterPolygon(points: readonly number[], amplitude: number, seed: number): number[] {
  const random = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push(
      points[i]! + (random() - 0.5) * 2 * amplitude,
      points[i + 1]! + (random() - 0.5) * 2 * amplitude
    );
  }
  return out;
}

function polylinePathData(points: readonly number[]): string {
  const parts = [`M ${N(points[0]!)} ${N(points[1]!)}`];
  for (let i = 2; i + 1 < points.length; i += 2) {
    parts.push(`L ${N(points[i]!)} ${N(points[i + 1]!)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** 닫힌 중점 이차베지어 스무딩 — 각 점을 제어점으로, 인접 중점 사이를 Q 로 잇는다. */
function smoothClosedPathData(points: readonly number[]): string {
  const count = points.length / 2;
  const midpoint = (i: number): [number, number] => {
    const next = (i + 1) % count;
    return [
      (points[i * 2]! + points[next * 2]!) / 2,
      (points[i * 2 + 1]! + points[next * 2 + 1]!) / 2,
    ];
  };
  const [mx0, my0] = midpoint(0);
  const parts = [`M ${N(mx0)} ${N(my0)}`];
  for (let i = 1; i <= count; i++) {
    const control = i % count;
    const [mx, my] = midpoint(control);
    parts.push(`Q ${N(points[control * 2]!)} ${N(points[control * 2 + 1]!)} ${N(mx)} ${N(my)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/**
 * 폐곡선 폴리곤(커스텀 모양 점 배열)에 손그림 스타일을 적용한 path d.
 * 점이 3개 미만이면 스타일 없이 그대로 폴리라인을 돌려준다(방어).
 */
export function styledBubblePolygonPathData(
  points: readonly number[],
  style: BubbleOutlineStyle,
  seedKey: string,
  strokeWidth: number
): string {
  if (points.length < 6 || points.length % 2 !== 0) {
    return points.length >= 4 ? polylinePathData(points) : "";
  }
  const params = STYLE_PARAMS[style];
  const subdivided = subdivideClosedPolygon(points, params.segmentSpacing);
  const jittered = jitterPolygon(
    subdivided,
    params.amplitude(Math.max(0, strokeWidth)),
    fnv1aHash(`${seedKey}|${style}`)
  );
  return params.smooth ? smoothClosedPathData(jittered) : polylinePathData(jittered);
}

/**
 * variant 실루엣 path(d)에 손그림 스타일을 적용한 path d. style 이 undefined(매끈)면 입력을
 * 그대로 반환한다 — 기본 렌더 경로가 바이트 단위로 불변임을 호출부가 믿을 수 있게.
 */
export function styledBubblePathData(
  d: string,
  style: BubbleOutlineStyle | undefined,
  seedKey: string,
  strokeWidth: number
): string {
  if (!style) return d;
  const polygon = sampleBubblePathDataToPolygon(d, 8);
  if (polygon.length < 6) return d;
  return styledBubblePolygonPathData(polygon, style, seedKey, strokeWidth);
}
