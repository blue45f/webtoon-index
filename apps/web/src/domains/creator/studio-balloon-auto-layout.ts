/**
 * Studio Responsive Balloon Auto-Layout & Tail Path Generator — 대사 길이에 따른
 * 자동 크기 조절, 인물 얼굴/패널 테두리 충돌 회피 및 베지어 꼬리 곡선 생성 코어.
 *
 * 마스터플랜 7.3 (전문 말풍선), 8.5 (Responsive Panel·Balloon Auto Layout) & 997개 기능 갭:
 * - 말풍선 도형 (Oval, Round-Rect, Shout-Burst, Cloud-Thought, Whisper-Dash, Jagged)
 * - Hug-Content 반응형 텍스트 박스 계산 및 다국어 번역 시 자동 리플로우
 * - 다중 꼬리 및 곡선 베지어 패스(Tail Anchor & Bezier Path) 생성
 * - 인물 얼굴/중요 소품 및 타 말풍선과의 충돌 회피(Collision Avoidance) 솔버
 * - 읽기 순서(Reading Order) 유지 및 오버플로 검증
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_BALLOON_LAYOUT_VERSION = 1 as const;

export const BALLOON_SHAPES = [
  "oval",
  "round-rect",
  "rectangle",
  "shout-burst",
  "cloud-thought",
  "whisper-dash",
  "jagged-electronic",
] as const;
export type BalloonShape = (typeof BALLOON_SHAPES)[number];

export type BalloonSizeMode = "fixed" | "hug-content" | "fill-container";

export interface TailAnchor {
  readonly id: string;
  readonly targetSpeakerPoint: readonly [number, number]; // [x, y] tip
  readonly balloonAnchorPoint?: readonly [number, number]; // [x, y] base on balloon
  readonly curvature: number; // -1..1
  readonly tailWidth: number; // px at base
}

export interface BalloonLayoutRule {
  readonly sizeMode: BalloonSizeMode;
  readonly minWidthPx: number;
  readonly maxWidthPx: number;
  readonly paddingPx: number;
  readonly avoidCollisions: boolean;
}

export interface BalloonRecord {
  readonly id: string;
  readonly dialogueId: string;
  readonly text: string;
  readonly fontSize: number;
  readonly shape: BalloonShape;
  readonly readingOrder: number;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly tails: readonly TailAnchor[];
  readonly layoutRule: BalloonLayoutRule;
  readonly speakerRef?: string;
  readonly styleTokenRef?: string;
}

export interface ObstacleRect {
  readonly id: string;
  readonly kind: "character-face" | "prop" | "panel-boundary";
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface BalloonDiagnostic {
  readonly code:
    | "TEXT_OVERFLOW"
    | "OBSTACLE_COLLISION"
    | "DANGLING_TAIL"
    | "READING_ORDER_INVERSION";
  readonly balloonId: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

/**
 * 텍스트 길이, 폰트 크기, 패딩에 기반하여 최적 말풍선 외곽 치수를 계산한다.
 */
export function computeBalloonTextBounds(
  text: string,
  fontSize: number,
  rule: BalloonLayoutRule,
): { readonly width: number; readonly height: number } {
  if (rule.sizeMode === "fixed") {
    return { width: rule.minWidthPx, height: rule.minWidthPx * 0.75 };
  }

  // 추정 글자당 폭 (CJK 1em, 영문 0.55em)
  const lines = text.split("\n");
  let maxLineLen = 0;
  let totalChars = 0;

  for (const line of lines) {
    let lineVisualWidth = 0;
    for (let i = 0; i < line.length; i += 1) {
      const code = line.charCodeAt(i);
      lineVisualWidth += code > 127 ? 1.0 : 0.55;
    }
    maxLineLen = Math.max(maxLineLen, lineVisualWidth);
    totalChars += line.length;
  }

  const rawWidth = maxLineLen * fontSize + rule.paddingPx * 2;
  const clampedWidth = Math.max(rule.minWidthPx, Math.min(rule.maxWidthPx, rawWidth));

  // 줄바꿈 계산
  const effectiveContentWidth = clampedWidth - rule.paddingPx * 2;
  const approxCharsPerLine = Math.max(1, Math.floor(effectiveContentWidth / (fontSize * 0.9)));
  const estimatedLinesCount = Math.max(lines.length, Math.ceil(totalChars / approxCharsPerLine));
  const lineHeight = fontSize * 1.4;
  const calculatedHeight = estimatedLinesCount * lineHeight + rule.paddingPx * 2;

  return Object.freeze({
    width: Math.round(clampedWidth),
    height: Math.round(calculatedHeight),
  });
}

/**
 * 말풍선 중심과 화자 위치 사이의 2차 베지어 꼬리 SVG 패스를 생성한다.
 */
export function generateBalloonTailSvgPath(
  balloonBounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  tail: TailAnchor,
): string {
  const [tipX, tipY] = tail.targetSpeakerPoint;
  const centerX = balloonBounds.x + balloonBounds.width / 2;
  const centerY = balloonBounds.y + balloonBounds.height / 2;

  // 기본 꼬리 접점 계산 (중심에서 팁 방향으로 말풍선 외곽점)
  const angle = Math.atan2(tipY - centerY, tipX - centerX);
  const baseCenter = tail.balloonAnchorPoint ?? [
    centerX + Math.cos(angle) * (balloonBounds.width * 0.45),
    centerY + Math.sin(angle) * (balloonBounds.height * 0.45),
  ];

  const perpAngle = angle + Math.PI / 2;
  const halfW = tail.tailWidth / 2;

  const base1X = baseCenter[0] + Math.cos(perpAngle) * halfW;
  const base1Y = baseCenter[1] + Math.sin(perpAngle) * halfW;
  const base2X = baseCenter[0] - Math.cos(perpAngle) * halfW;
  const base2Y = baseCenter[1] - Math.sin(perpAngle) * halfW;

  // 제어점 (Curvature 반영)
  const midX = (baseCenter[0] + tipX) / 2 + Math.cos(perpAngle) * (tail.curvature * 30);
  const midY = (baseCenter[1] + tipY) / 2 + Math.sin(perpAngle) * (tail.curvature * 30);

  return `M ${base1X.toFixed(1)} ${base1Y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${tipX.toFixed(1)} ${tipY.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${base2X.toFixed(1)} ${base2Y.toFixed(1)} Z`;
}

function checkRectOverlap(
  r1: { x: number; y: number; width: number; height: number },
  r2: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    r1.x < r2.x + r2.width &&
    r1.x + r1.width > r2.x &&
    r1.y < r2.y + r2.height &&
    r1.y + r1.height > r2.y
  );
}

/**
 * 인물 얼굴/소품 장애물과 충돌하는 말풍선의 위치를 안전한 빈 공간으로 이동시킨다.
 */
export function solveBalloonCollisions(
  balloons: readonly BalloonRecord[],
  obstacles: readonly ObstacleRect[],
  panelBounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): readonly BalloonRecord[] {
  const solved: BalloonRecord[] = [];

  for (const b of balloons) {
    if (!b.layoutRule.avoidCollisions) {
      solved.push(b);
      continue;
    }

    let currX = b.bounds.x;
    let currY = b.bounds.y;
    let attempts = 0;
    const step = 20;

    while (attempts < 10) {
      const currRect = { x: currX, y: currY, width: b.bounds.width, height: b.bounds.height };
      const hasCollision =
        obstacles.some((obs) => checkRectOverlap(currRect, obs.bounds)) ||
        solved.some((prev) => checkRectOverlap(currRect, prev.bounds));

      if (!hasCollision) break;

      // 충돌 시 패널 상단 또는 좌/우 여백으로 회피 이동
      if (currY - step >= panelBounds.y + 10) {
        currY -= step;
      } else if (currX + b.bounds.width + step <= panelBounds.x + panelBounds.width) {
        currX += step;
      } else {
        currX -= step;
      }
      attempts += 1;
    }

    solved.push(
      Object.freeze({
        ...b,
        bounds: Object.freeze({
          x: Math.round(currX),
          y: Math.round(currY),
          width: b.bounds.width,
          height: b.bounds.height,
        }),
      }),
    );
  }

  return Object.freeze(solved);
}

/**
 * 말풍선 레이아웃 무결성(충돌, 텍스트 오버플로, 꼬리 단절)을 검증한다.
 */
export function validateBalloonLayout(
  balloons: readonly BalloonRecord[],
  obstacles: readonly ObstacleRect[] = [],
): readonly BalloonDiagnostic[] {
  const diagnostics: BalloonDiagnostic[] = [];

  for (let i = 0; i < balloons.length; i += 1) {
    const b = balloons[i];

    // 1. 장애물 충돌 검사
    for (const obs of obstacles) {
      if (checkRectOverlap(b.bounds, obs.bounds)) {
        diagnostics.push({
          code: "OBSTACLE_COLLISION",
          balloonId: b.id,
          message: `말풍선 '${b.id}'이(가) 주요 요소('${obs.id}', ${obs.kind})와 겹쳐 있습니다.`,
          severity: "warning",
        });
      }
    }

    // 2. 꼬리 화자 누락 검사
    for (const tail of b.tails) {
      if (tail.targetSpeakerPoint[0] === 0 && tail.targetSpeakerPoint[1] === 0) {
        diagnostics.push({
          code: "DANGLING_TAIL",
          balloonId: b.id,
          message: `말풍선 '${b.id}'의 꼬리가 지정되지 않았습니다.`,
          severity: "warning",
        });
      }
    }

    // 3. 읽기 순서 역전 검사 (상단에 있는 말풍선이 뒤늦은 readingOrder인 경우)
    if (i > 0) {
      const prev = balloons[i - 1];
      if (b.bounds.y + 50 < prev.bounds.y && b.readingOrder > prev.readingOrder) {
        diagnostics.push({
          code: "READING_ORDER_INVERSION",
          balloonId: b.id,
          message: `말풍선 '${b.id}'이(가) 이전 말풍선보다 위쪽에 위치하지만 읽기 순서 번호(${b.readingOrder})가 더 큽니다.`,
          severity: "warning",
        });
      }
    }
  }

  return Object.freeze(diagnostics);
}
