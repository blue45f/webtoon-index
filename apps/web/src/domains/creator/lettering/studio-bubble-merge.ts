/**
 * Studio Bubble Merge — 겹친 말풍선 2개 이상을 하나의 외곽선으로 병합(클립스튜디오 "말풍선
 * 합치기")하는 순수 코어.
 *
 * 파이프라인:
 *   1) bubbleSilhouetteLocalPolygon — 각 말풍선의 "화면에 보이는" 실루엣을 variant 별 path
 *      생성기(studio-bubble-path)로 만들고 폴리곤으로 샘플링한다. 커스텀 모양이 있으면 그
 *      점 배열을 그대로 쓴다. 렌더와 같은 생성기를 재사용하므로 병합 입력과 화면 모양이
 *      일치한다(생각풍선 구름방울·시스템 이중 프레임 같은 장식 요소는 실루엣이 아니라서
 *      제외 — 패널 문구로 안내).
 *   2) 로컬 폴리곤 → 페이지 좌표(회전 반영, Konva Group 의 (0,0) 기준 회전 규약 —
 *      studio-bubble-custom-shape 의 프레임 변환 재사용).
 *   3) polygon-clipping union(studio-path-boolean 의 combineStudioShapePolygons 재사용 —
 *      라이브러리는 그 모듈 안에서 lazy 로드) 을 순차 적용.
 *   4) 결과가 폴리곤 1개면 성공 — 바깥 링을 생존 말풍선의 customShapePoints(로컬 좌표)로
 *      굽고, bbox 를 새 x/y/width/height 로 삼는다. 2개 이상이면 서로 안 겹친 말풍선이
 *      있다는 뜻이라 실패(클립스튜디오와 동일하게 겹칠 때만 병합).
 *
 * 대사는 생존자(z-순서 맨 뒤) 텍스트 뒤에 나머지를 줄바꿈으로 이어 붙인다. 구멍(hole)은
 * 말풍선 실루엣 조합에선 사실상 나오지 않아 버린다(문서화된 절충 — 채움이 덮는다).
 *
 * 순수·결정적 — DOM/Konva/난수/시간 의존 없음. polygon-clipping 로드만 비동기다.
 */
import { unionStudioPolygons, type StudioPathPolygon, type StudioPathRing } from "../studio-path-boolean";

import {
  bubbleShapeLocalPointToCanvas,
  computeBubbleShapeGeometry,
  normalizeCustomShapePoints,
  sampleBubblePathDataToPolygon,
  sampleBubbleOutlineToPolygon,
  type BubbleShapeTheme,
} from "./studio-bubble-custom-shape";
import {
  BURST_STAR_VARIANT_PARAMS,
  bubblePathData,
  burstStarPathData,
  doubleBubblePathData,
  heartBubblePathData,
  normalizeBurstStarPoints,
  normalizeExtraTails,
  scaredBubblePathData,
  thoughtBubbleBodyPath,
} from "./studio-bubble-path";

import type { BubbleEl, El } from "../studio-element-model";

export const BUBBLE_MERGE_MIN_COUNT = 2;
export const BUBBLE_MERGE_MAX_COUNT = 6;

/** 병합 결과 최소 크기 — 렌더 최소 규약(60×50)과 동일하게 유지한다. */
const MERGE_MIN_WIDTH = 60;
const MERGE_MIN_HEIGHT = 50;

export type BubbleMergeResult =
  | {
      ok: true;
      survivorId: string;
      removedIds: string[];
      patch: Partial<BubbleEl>;
    }
  | { ok: false; reason: string };

/**
 * 선택이 병합 가능한 구성인지 — 패널 버튼 잠금 사유(null 이면 시도 가능).
 * 겹침 여부는 지오메트리 연산이 필요해 실제 병합 시점에 검사한다.
 */
export function bubbleMergeUnavailableReason(selection: readonly El[]): string | null {
  const bubbles = selection.filter((el) => el.type === "bubble");
  if (bubbles.length !== selection.length) {
    return "말풍선만 함께 선택해야 병합할 수 있어요.";
  }
  if (bubbles.length < BUBBLE_MERGE_MIN_COUNT) {
    return "말풍선 2개 이상을 함께 선택하세요.";
  }
  if (bubbles.length > BUBBLE_MERGE_MAX_COUNT) {
    return `한 번에 최대 ${BUBBLE_MERGE_MAX_COUNT}개까지 병합할 수 있어요.`;
  }
  return null;
}

/** variant 별 박스류 모서리 반경 — StudioKonvaBubbleNode/studio-svg-export 의 하드코딩과 동일. */
function boxCornerRadius(theme: BubbleShapeTheme): number {
  return theme === "soft" ? 6 : theme === "vivid" ? 3 : 4;
}

function phoneCornerRadius(theme: BubbleShapeTheme): number {
  return theme === "soft" ? 10 : theme === "vivid" ? 6 : 8;
}

/**
 * 말풍선의 "화면 실루엣" 폴리곤(요소 로컬 좌표, 평탄 [x0,y0,...]).
 * 커스텀 모양이 있으면 그 점 배열을 그대로 반환한다.
 */
export function bubbleSilhouetteLocalPolygon(el: BubbleEl, theme: BubbleShapeTheme): number[] {
  const custom = normalizeCustomShapePoints(el.customShapePoints);
  if (custom && custom.length >= 6) return custom;

  const geometry = computeBubbleShapeGeometry({
    width: el.width,
    height: el.height,
    theme,
    tail: el.tail,
    tailDirection: el.tailDirection,
    tailXRatio: el.tailXRatio,
    tailHeight: el.tailHeight,
    tailBase: el.tailBase,
    tailBend: el.tailBend,
    extraTails: normalizeExtraTails(el.extraTails),
  });
  const tailSpec = geometry.tailSpec;
  const minDim = Math.min(el.width, el.height);

  switch (el.variant) {
    case "shout":
    case "angry": {
      const params = BURST_STAR_VARIANT_PARAMS[el.variant];
      const amplitude = Math.min(0.95, Math.max(0.1, el.starAmplitude ?? params.innerRatio));
      return sampleBubblePathDataToPolygon(
        burstStarPathData(
          el.width,
          el.height,
          normalizeBurstStarPoints(el.starPoints, params.points),
          params.outer * amplitude,
          params.outer
        )
      );
    }
    case "double":
      return sampleBubblePathDataToPolygon(doubleBubblePathData(el.width, el.height, tailSpec));
    case "thought":
      return sampleBubblePathDataToPolygon(thoughtBubbleBodyPath(el.width, el.height));
    case "scared":
      return sampleBubblePathDataToPolygon(scaredBubblePathData(el.width, el.height, tailSpec));
    case "heart":
      return sampleBubblePathDataToPolygon(heartBubblePathData(el.width, el.height));
    case "system":
      return sampleBubblePathDataToPolygon(bubblePathData(el.width, el.height, 4, null));
    case "box":
      return sampleBubblePathDataToPolygon(
        bubblePathData(el.width, el.height, boxCornerRadius(theme), null)
      );
    case "phone": {
      const phoneTail = tailSpec
        ? {
            ...tailSpec,
            length: Math.min(tailSpec.length, Math.max(8, minDim * 0.1)),
            base: Math.min(tailSpec.base, Math.max(6, minDim * 0.12)),
          }
        : null;
      return sampleBubblePathDataToPolygon(
        bubblePathData(el.width, el.height, phoneCornerRadius(theme), phoneTail)
      );
    }
    default:
      // speech/whisper — 렌더의 speechPathData 와 동일한 합성(다중 꼬리 포함).
      return sampleBubbleOutlineToPolygon(el.width, el.height, geometry);
  }
}

function localPolygonToPageRing(el: BubbleEl, points: readonly number[]): StudioPathRing {
  const frame = { x: el.x, y: el.y, rotation: el.rotation };
  const ring: StudioPathRing = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const page = bubbleShapeLocalPointToCanvas({ x: points[i]!, y: points[i + 1]! }, frame);
    ring.push([page.x, page.y]);
  }
  return ring;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * z-순서(입력 순서 = 뒤→앞) 말풍선들을 하나로 병합한다. 생존자는 첫 번째(맨 뒤) 말풍선 —
 * 스타일·글꼴을 그대로 유지하고 외곽선만 병합 결과로 바뀐다.
 */
export async function mergeStudioBubbles(
  bubbles: readonly BubbleEl[],
  theme: BubbleShapeTheme
): Promise<BubbleMergeResult> {
  const gate = bubbleMergeUnavailableReason(bubbles);
  if (gate) return { ok: false, reason: gate };

  const rings: StudioPathRing[] = [];
  for (const bubble of bubbles) {
    const local = bubbleSilhouetteLocalPolygon(bubble, theme);
    if (local.length < 6) {
      return { ok: false, reason: "실루엣을 계산할 수 없는 말풍선이 있어요." };
    }
    rings.push(localPolygonToPageRing(bubble, local));
  }

  let combined: StudioPathPolygon[];
  try {
    combined = await unionStudioPolygons(rings.map((ring): StudioPathPolygon => [ring]));
  } catch {
    return { ok: false, reason: "말풍선 병합 연산이 실패했어요(위치를 조금 바꿔 다시 시도해 주세요)." };
  }

  if (combined.length !== 1) {
    return {
      ok: false,
      reason: "서로 겹치지 않는 말풍선이 있어요 — 말풍선끼리 겹치게 놓은 뒤 병합하세요.",
    };
  }

  const outer = combined[0]![0]!;
  if (!outer || outer.length < 3) {
    return { ok: false, reason: "병합 결과가 비어 있어요." };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const width = Math.max(MERGE_MIN_WIDTH, round2(maxX - minX));
  const height = Math.max(MERGE_MIN_HEIGHT, round2(maxY - minY));
  const customShapePoints: number[] = [];
  for (const [x, y] of outer) {
    customShapePoints.push(round2(x - minX), round2(y - minY));
  }

  const survivor = bubbles[0]!;
  const texts = bubbles
    .map((bubble) => bubble.text)
    .filter((text) => text.trim().length > 0);

  return {
    ok: true,
    survivorId: survivor.id,
    removedIds: bubbles.slice(1).map((bubble) => bubble.id),
    patch: {
      x: round2(minX),
      y: round2(minY),
      width,
      height,
      rotation: 0,
      customShapePoints,
      text: texts.join("\n"),
      // 병합 외곽선에 꼬리가 이미 구워졌다 — 자동 부착이 남아 있으면 커밋마다 꼬리 값을
      // 다시 계산해 혼란을 주므로 함께 해제한다(수동 tail 필드는 되돌리기용으로 보존).
      tailAnchorId: undefined,
      tailAnchorPoint: undefined,
    },
  };
}
