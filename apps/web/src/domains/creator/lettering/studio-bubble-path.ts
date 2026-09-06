/**
 * Studio Bubble Path — 말풍선 본체+꼬리를 하나의 연속 SVG path로 그린다.
 *
 * 기존 말풍선은 둥근 Rect 위에 삼각형 Line 꼬리를 따로 얹어, 본체 외곽선이 꼬리 밑동을
 * 가로질러 "이중 외곽선 이음새"가 보였다(어색함의 원인). 이 모듈은 둥근 사각형 외곽선을
 * 따라가다 꼬리가 있는 변에서만 바깥으로 삐져나갔다 돌아오는 단일 path를 만들어, 이음새
 * 없이 매끈하게 꼬리가 본체와 이어지게 한다.
 *
 * 전부 순수·결정적. 좌표는 말풍선 로컬(0,0~w,h). Konva <Path data=...>에 그대로 넣는다.
 */

export type BubbleTailDirection = "bottom" | "top" | "left" | "right";
export type BubbleTailSide = "left" | "right" | "center";

export interface BubbleTailSpec {
  direction: BubbleTailDirection;
  ratio: number; // 변을 따라 꼬리 밑동 중심 위치(0~1)
  length: number; // 바깥으로 뻗는 길이(px)
  base: number; // 꼬리 밑동 너비(px)
  side: BubbleTailSide; // 꼬리 끝이 기우는 방향(화자 쪽)
  /** -1..1. 음수는 진행축의 왼쪽/위쪽, 양수는 오른쪽/아래쪽으로 꼬리 몸통을 휜다. */
  bend?: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const N = (n: number): string => (Math.round(n * 100) / 100).toString();

/**
 * 둥근 사각형(+선택적 꼬리) 단일 path. r은 (w,h)/2로 자동 클램프.
 * 꼬리는 해당 변의 직선 구간(둥근 모서리 안쪽)에서만 솟아나며, 끝점은 side로 기운다.
 */
export function bubblePathData(w: number, h: number, radius: number, tail?: BubbleTailSpec | null): string {
  const r = clamp(radius, 0, Math.min(w, h) / 2);
  // 꼬리가 없으면 단순 둥근 사각형.
  if (!tail || tail.length <= 0 || tail.base <= 0) {
    return roundedRect(w, h, r);
  }
  const dir = tail.direction;
  // 꼬리 끝 기울기(화자 방향). 0.45로 키워 더 자연스러운 lean(현재 호출은 side:center라 시각변화 없음, 선반영).
  const sideShift = tail.side === "left" ? -tail.base * 0.45 : tail.side === "right" ? tail.base * 0.45 : 0;
  const bend = clamp(tail.bend ?? 0, -1, 1) * Math.min(Math.max(tail.base, tail.length) * 0.42, tail.base * 1.4);
  // 꼬리 밑동이 둥근 모서리 직선구간 안에 들도록 안전 마진(곡률 충돌 방지).
  const safe = r * 0.8;
  // 테이퍼: 밑동→끝 변을 직선 대신 이차베지어로 본체 쪽 0.55 지점으로 당겨 코미포/클립스튜디오식 부드러운 수렴.
  const TAPER = 0.55;

  if (dir === "bottom" || dir === "top") {
    const center = clamp(w * tail.ratio, r + tail.base / 2 + safe, w - r - tail.base / 2 - safe);
    const b1 = center - tail.base / 2;
    const b2 = center + tail.base / 2;
    const tip = clamp(center + sideShift, r + safe, w - r - safe);
    if (dir === "bottom") {
      const ty = h + tail.length;
      const cy = h + (ty - h) * TAPER;
      return [
        `M ${N(r)} 0`,
        `H ${N(w - r)}`,
        `A ${N(r)} ${N(r)} 0 0 1 ${N(w)} ${N(r)}`,
        `V ${N(h - r)}`,
        `A ${N(r)} ${N(r)} 0 0 1 ${N(w - r)} ${N(h)}`,
        `H ${N(b2)}`,
        `Q ${N((b2 + tip) / 2 + bend)} ${N(cy)} ${N(tip)} ${N(ty)}`,
        `Q ${N((tip + b1) / 2 + bend)} ${N(cy)} ${N(b1)} ${N(h)}`,
        `H ${N(r)}`,
        `A ${N(r)} ${N(r)} 0 0 1 0 ${N(h - r)}`,
        `V ${N(r)}`,
        `A ${N(r)} ${N(r)} 0 0 1 ${N(r)} 0`,
        "Z",
      ].join(" ");
    }
    // top
    const ty = -tail.length;
    const cy = ty * TAPER; // 본체변(0)→tip 사이 0.55 지점
    return [
      `M ${N(r)} 0`,
      `H ${N(b1)}`,
      `Q ${N((b1 + tip) / 2 + bend)} ${N(cy)} ${N(tip)} ${N(ty)}`,
      `Q ${N((tip + b2) / 2 + bend)} ${N(cy)} ${N(b2)} 0`,
      `H ${N(w - r)}`,
      `A ${N(r)} ${N(r)} 0 0 1 ${N(w)} ${N(r)}`,
      `V ${N(h - r)}`,
      `A ${N(r)} ${N(r)} 0 0 1 ${N(w - r)} ${N(h)}`,
      `H ${N(r)}`,
      `A ${N(r)} ${N(r)} 0 0 1 0 ${N(h - r)}`,
      `V ${N(r)}`,
      `A ${N(r)} ${N(r)} 0 0 1 ${N(r)} 0`,
      "Z",
    ].join(" ");
  }

  // left / right
  const center = clamp(h * tail.ratio, r + tail.base / 2 + safe, h - r - tail.base / 2 - safe);
  const b1 = center - tail.base / 2;
  const b2 = center + tail.base / 2;
  const tip = clamp(center + sideShift, r + safe, h - r - safe);
  if (dir === "left") {
    const tx = -tail.length;
    const cx = tx * TAPER;
    return [
      `M ${N(r)} 0`,
      `H ${N(w - r)}`,
      `A ${N(r)} ${N(r)} 0 0 1 ${N(w)} ${N(r)}`,
      `V ${N(h - r)}`,
      `A ${N(r)} ${N(r)} 0 0 1 ${N(w - r)} ${N(h)}`,
      `H ${N(r)}`,
      `A ${N(r)} ${N(r)} 0 0 1 0 ${N(h - r)}`,
      `V ${N(b2)}`,
      `Q ${N(cx)} ${N((b2 + tip) / 2 + bend)} ${N(tx)} ${N(tip)}`,
      `Q ${N(cx)} ${N((tip + b1) / 2 + bend)} 0 ${N(b1)}`,
      `V ${N(r)}`,
      `A ${N(r)} ${N(r)} 0 0 1 ${N(r)} 0`,
      "Z",
    ].join(" ");
  }
  // right
  const tx = w + tail.length;
  const cx = w + (tx - w) * TAPER;
  return [
    `M ${N(r)} 0`,
    `H ${N(w - r)}`,
    `A ${N(r)} ${N(r)} 0 0 1 ${N(w)} ${N(r)}`,
    `V ${N(b1)}`,
    `Q ${N(cx)} ${N((b1 + tip) / 2 + bend)} ${N(tx)} ${N(tip)}`,
    `Q ${N(cx)} ${N((tip + b2) / 2 + bend)} ${N(w)} ${N(b2)}`,
    `V ${N(h - r)}`,
    `A ${N(r)} ${N(r)} 0 0 1 ${N(w - r)} ${N(h)}`,
    `H ${N(r)}`,
    `A ${N(r)} ${N(r)} 0 0 1 0 ${N(h - r)}`,
    `V ${N(r)}`,
    `A ${N(r)} ${N(r)} 0 0 1 ${N(r)} 0`,
    "Z",
  ].join(" ");
}

/**
 * 긴 대사·시간차 대사용 이중 로브 말풍선.
 *
 * 두 타원을 겹쳐 그리면 가운데 외곽선이 남으므로, 위·아래 로브와 허리를 하나의 연속 path로
 * 만든다. 주 꼬리는 어느 변에나 붙일 수 있고 bubblePathData와 같은 밑동·기울기·곡률 규약을
 * 사용한다. 이 변형은 한 화자의 이어지는 대사용이라 추가 꼬리는 받지 않는다.
 */
export function doubleBubblePathData(w: number, h: number, tail?: BubbleTailSpec | null): string {
  const r = clamp(Math.min(w * 0.12, h * 0.13), 0, Math.min(w, h) / 3);
  const upperEnd = h * 0.34;
  const upperJoin = h * 0.43;
  const middle = h * 0.5;
  const lowerJoin = h * 0.57;
  const lowerStart = h * 0.66;
  const waistInset = Math.min(w * 0.085, Math.max(4, r * 0.75));
  const activeTail = tail && tail.length > 0 && tail.base > 0 ? tail : null;
  const TAPER = 0.55;

  type HorizontalTailPlan = { b1: number; b2: number; tip: number; bend: number; len: number };
  type VerticalTailPlan = HorizontalTailPlan & { section: "upper" | "lower" };

  const horizontalPlan = (): HorizontalTailPlan | null => {
    if (!activeTail) return null;
    const span = Math.max(0, w - r * 2 - 8);
    if (span < 4) return null;
    const base = Math.min(activeTail.base, span);
    const half = base / 2;
    const center = clamp(w * activeTail.ratio, r + half + 4, w - r - half - 4);
    const sideShift = activeTail.side === "left" ? -base * 0.45 : activeTail.side === "right" ? base * 0.45 : 0;
    return {
      b1: center - half,
      b2: center + half,
      tip: clamp(center + sideShift, r + 2, w - r - 2),
      bend: clamp(activeTail.bend ?? 0, -1, 1) * Math.min(Math.max(base, activeTail.length) * 0.42, base * 1.4),
      len: activeTail.length,
    };
  };

  const verticalPlan = (): VerticalTailPlan | null => {
    if (!activeTail) return null;
    const section = activeTail.ratio < 0.5 ? "upper" : "lower";
    const start = section === "upper" ? r : lowerStart;
    const end = section === "upper" ? upperEnd : h - r;
    const span = Math.max(0, end - start - 8);
    if (span < 4) return null;
    const base = Math.min(activeTail.base, span);
    const half = base / 2;
    const center = clamp(h * activeTail.ratio, start + half + 4, end - half - 4);
    const sideShift = activeTail.side === "left" ? -base * 0.45 : activeTail.side === "right" ? base * 0.45 : 0;
    return {
      section,
      b1: center - half,
      b2: center + half,
      tip: clamp(center + sideShift, start + 2, end - 2),
      bend: clamp(activeTail.bend ?? 0, -1, 1) * Math.min(Math.max(base, activeTail.length) * 0.42, base * 1.4),
      len: activeTail.length,
    };
  };

  const horizontal = activeTail?.direction === "top" || activeTail?.direction === "bottom" ? horizontalPlan() : null;
  const vertical = activeTail?.direction === "left" || activeTail?.direction === "right" ? verticalPlan() : null;
  const parts: string[] = [`M ${N(r)} 0`];

  if (activeTail?.direction === "top" && horizontal) {
    const ty = -horizontal.len;
    const cy = ty * TAPER;
    parts.push(
      `H ${N(horizontal.b1)}`,
      `Q ${N((horizontal.b1 + horizontal.tip) / 2 + horizontal.bend)} ${N(cy)} ${N(horizontal.tip)} ${N(ty)}`,
      `Q ${N((horizontal.tip + horizontal.b2) / 2 + horizontal.bend)} ${N(cy)} ${N(horizontal.b2)} 0`
    );
  }
  parts.push(`H ${N(w - r)}`, `Q ${N(w)} 0 ${N(w)} ${N(r)}`);

  if (activeTail?.direction === "right" && vertical?.section === "upper") {
    const tx = w + vertical.len;
    const cx = w + vertical.len * TAPER;
    parts.push(
      `V ${N(vertical.b1)}`,
      `Q ${N(cx)} ${N((vertical.b1 + vertical.tip) / 2 + vertical.bend)} ${N(tx)} ${N(vertical.tip)}`,
      `Q ${N(cx)} ${N((vertical.tip + vertical.b2) / 2 + vertical.bend)} ${N(w)} ${N(vertical.b2)}`
    );
  }
  parts.push(`V ${N(upperEnd)}`);
  parts.push(
    `Q ${N(w)} ${N(upperJoin)} ${N(w - waistInset)} ${N(middle)}`,
    `Q ${N(w)} ${N(lowerJoin)} ${N(w)} ${N(lowerStart)}`
  );
  if (activeTail?.direction === "right" && vertical?.section === "lower") {
    const tx = w + vertical.len;
    const cx = w + vertical.len * TAPER;
    parts.push(
      `V ${N(vertical.b1)}`,
      `Q ${N(cx)} ${N((vertical.b1 + vertical.tip) / 2 + vertical.bend)} ${N(tx)} ${N(vertical.tip)}`,
      `Q ${N(cx)} ${N((vertical.tip + vertical.b2) / 2 + vertical.bend)} ${N(w)} ${N(vertical.b2)}`
    );
  }
  parts.push(`V ${N(h - r)}`, `Q ${N(w)} ${N(h)} ${N(w - r)} ${N(h)}`);

  if (activeTail?.direction === "bottom" && horizontal) {
    const ty = h + horizontal.len;
    const cy = h + horizontal.len * TAPER;
    parts.push(
      `H ${N(horizontal.b2)}`,
      `Q ${N((horizontal.b2 + horizontal.tip) / 2 + horizontal.bend)} ${N(cy)} ${N(horizontal.tip)} ${N(ty)}`,
      `Q ${N((horizontal.tip + horizontal.b1) / 2 + horizontal.bend)} ${N(cy)} ${N(horizontal.b1)} ${N(h)}`
    );
  }
  parts.push(`H ${N(r)}`, `Q 0 ${N(h)} 0 ${N(h - r)}`);

  if (activeTail?.direction === "left" && vertical?.section === "lower") {
    const tx = -vertical.len;
    const cx = tx * TAPER;
    parts.push(
      `V ${N(vertical.b2)}`,
      `Q ${N(cx)} ${N((vertical.b2 + vertical.tip) / 2 + vertical.bend)} ${N(tx)} ${N(vertical.tip)}`,
      `Q ${N(cx)} ${N((vertical.tip + vertical.b1) / 2 + vertical.bend)} 0 ${N(vertical.b1)}`
    );
  }
  parts.push(`V ${N(lowerStart)}`);
  parts.push(
    `Q 0 ${N(lowerJoin)} ${N(waistInset)} ${N(middle)}`,
    `Q 0 ${N(upperJoin)} 0 ${N(upperEnd)}`
  );
  if (activeTail?.direction === "left" && vertical?.section === "upper") {
    const tx = -vertical.len;
    const cx = tx * TAPER;
    parts.push(
      `V ${N(vertical.b2)}`,
      `Q ${N(cx)} ${N((vertical.b2 + vertical.tip) / 2 + vertical.bend)} ${N(tx)} ${N(vertical.tip)}`,
      `Q ${N(cx)} ${N((vertical.tip + vertical.b1) / 2 + vertical.bend)} 0 ${N(vertical.b1)}`
    );
  }
  parts.push(`V ${N(r)}`, `Q 0 0 ${N(r)} 0`, "Z");
  return parts.join(" ");
}

/* ── 다중 꼬리(최대 3) — 두 화자 동시 대사/합창 말풍선 ─────────────────────
 * 단일 꼬리 bubblePathData는 하위호환을 위해 그대로 두고(출력 바이트 동일 보장),
 * 다중 꼬리는 둘레를 한 바퀴 걷는 일반화 워커로 만든다. 각 변에서 꼬리들을
 * 진행 방향 순서로 정렬해 홈(notch)을 이어 붙인다. 겹치면 진행 방향으로 밀어낸다.
 */

export const BUBBLE_MAX_TAILS = 3;

interface NotchPlan {
  b1: number; // 밑동 시작(진행 방향 기준 앞쪽)
  b2: number; // 밑동 끝
  tip: number; // 끝점의 변 방향 좌표
  len: number; // 바깥으로 뻗는 길이
  bend: number; // 변 진행축 기준 곡률 제어점 오프셋
}

/** 한 변 위 꼬리들을 진행 좌표로 정렬·클램프하고 겹침을 밀어내 홈 계획을 만든다. */
function planNotches(tails: BubbleTailSpec[], span: number, r: number): NotchPlan[] {
  const safe = r * 0.8;
  const GAP = 4; // 인접 홈 사이 최소 간격(px)
  const plans = tails
    .filter((t) => t.length > 0 && t.base > 0)
    .map((t) => {
      const half = t.base / 2;
      const center = clamp(span * t.ratio, r + half + safe, span - r - half - safe);
      const sideShift = t.side === "left" ? -t.base * 0.45 : t.side === "right" ? t.base * 0.45 : 0;
      return {
        center,
        half,
        len: t.length,
        tip: clamp(center + sideShift, r + safe, span - r - safe),
        bend: clamp(t.bend ?? 0, -1, 1) * Math.min(Math.max(t.base, t.length) * 0.42, t.base * 1.4),
      };
    })
    .sort((a, b) => a.center - b.center);

  // 겹침 해소 — 앞에서부터 진행 방향으로 밀어내고, 범위를 벗어나면 그 홈은 버린다.
  const out: NotchPlan[] = [];
  let cursor = 0;
  for (const p of plans) {
    const minB1 = Math.max(p.center - p.half, cursor + (out.length > 0 ? GAP : 0));
    const b1 = minB1;
    const b2 = b1 + p.half * 2;
    if (b2 > span - r * 0.8 - 0.5) continue; // 변 밖으로 밀려나면 스킵(안전)
    const drift = b1 + p.half - p.center;
    out.push({
      b1,
      b2,
      tip: clamp(p.tip + drift, b1 - p.half, b2 + p.half),
      len: p.len,
      bend: p.bend,
    });
    cursor = b2;
  }
  return out;
}

/**
 * 다중 꼬리 말풍선 단일 path. tails가 0개면 roundedRect, 1개여도 동작(단일 꼬리와
 * 시각적으로 동일 규약: 테이퍼 0.55 이차베지어). 최대 BUBBLE_MAX_TAILS개.
 */
export function bubblePathDataMulti(w: number, h: number, radius: number, tails: readonly BubbleTailSpec[]): string {
  const r = clamp(radius, 0, Math.min(w, h) / 2);
  const valid = tails.filter((t) => t && t.length > 0 && t.base > 0).slice(0, BUBBLE_MAX_TAILS);
  if (valid.length === 0) return roundedRect(w, h, r);
  const TAPER = 0.55;

  const byDir = (d: BubbleTailDirection) => valid.filter((t) => t.direction === d);
  const top = planNotches(byDir("top"), w, r);
  const right = planNotches(byDir("right"), h, r);
  const bottom = planNotches(byDir("bottom"), w, r);
  const left = planNotches(byDir("left"), h, r);

  const parts: string[] = [`M ${N(r)} 0`];
  // 윗변: x 증가 방향. 홈은 b1→tip→b2 순.
  for (const nt of top) {
    const ty = -nt.len;
    const cy = ty * TAPER;
    parts.push(`H ${N(nt.b1)}`, `Q ${N((nt.b1 + nt.tip) / 2 + nt.bend)} ${N(cy)} ${N(nt.tip)} ${N(ty)}`, `Q ${N((nt.tip + nt.b2) / 2 + nt.bend)} ${N(cy)} ${N(nt.b2)} 0`);
  }
  parts.push(`H ${N(w - r)}`, `A ${N(r)} ${N(r)} 0 0 1 ${N(w)} ${N(r)}`);
  // 오른변: y 증가 방향.
  for (const nt of right) {
    const tx = w + nt.len;
    const cx = w + nt.len * TAPER;
    parts.push(`V ${N(nt.b1)}`, `Q ${N(cx)} ${N((nt.b1 + nt.tip) / 2 + nt.bend)} ${N(tx)} ${N(nt.tip)}`, `Q ${N(cx)} ${N((nt.tip + nt.b2) / 2 + nt.bend)} ${N(w)} ${N(nt.b2)}`);
  }
  parts.push(`V ${N(h - r)}`, `A ${N(r)} ${N(r)} 0 0 1 ${N(w - r)} ${N(h)}`);
  // 아랫변: x 감소 방향 — 정렬은 증가 기준이므로 역순 순회, 홈은 b2→tip→b1.
  for (const nt of [...bottom].reverse()) {
    const ty = h + nt.len;
    const cy = h + nt.len * TAPER;
    parts.push(`H ${N(nt.b2)}`, `Q ${N((nt.b2 + nt.tip) / 2 + nt.bend)} ${N(cy)} ${N(nt.tip)} ${N(ty)}`, `Q ${N((nt.tip + nt.b1) / 2 + nt.bend)} ${N(cy)} ${N(nt.b1)} ${N(h)}`);
  }
  parts.push(`H ${N(r)}`, `A ${N(r)} ${N(r)} 0 0 1 0 ${N(h - r)}`);
  // 왼변: y 감소 방향 — 역순 순회, 홈은 b2→tip→b1.
  for (const nt of [...left].reverse()) {
    const tx = -nt.len;
    const cx = tx * TAPER;
    parts.push(`V ${N(nt.b2)}`, `Q ${N(cx)} ${N((nt.b2 + nt.tip) / 2 + nt.bend)} ${N(tx)} ${N(nt.tip)}`, `Q ${N(cx)} ${N((nt.tip + nt.b1) / 2 + nt.bend)} 0 ${N(nt.b1)}`);
  }
  parts.push(`V ${N(r)}`, `A ${N(r)} ${N(r)} 0 0 1 ${N(r)} 0`, "Z");
  return parts.join(" ");
}

/** 저장 문서의 추가 꼬리 배열을 안전하게 정규화한다(주 꼬리 외 최대 2개). */
export function normalizeExtraTails(raw: unknown): BubbleTailSpec[] {
  if (!Array.isArray(raw)) return [];
  const dirs: BubbleTailDirection[] = ["bottom", "top", "left", "right"];
  const sides: BubbleTailSide[] = ["left", "right", "center"];
  const out: BubbleTailSpec[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Partial<BubbleTailSpec>;
    if (!dirs.includes(e.direction as BubbleTailDirection)) continue;
    out.push({
      direction: e.direction as BubbleTailDirection,
      ratio: clamp(typeof e.ratio === "number" && Number.isFinite(e.ratio) ? e.ratio : 0.5, 0, 1),
      length: clamp(typeof e.length === "number" && Number.isFinite(e.length) ? e.length : 26, 4, 200),
      base: clamp(typeof e.base === "number" && Number.isFinite(e.base) ? e.base : 18, 4, 120),
      side: sides.includes(e.side as BubbleTailSide) ? (e.side as BubbleTailSide) : "center",
      bend: clamp(typeof e.bend === "number" && Number.isFinite(e.bend) ? e.bend : 0, -1, 1),
    });
    if (out.length >= BUBBLE_MAX_TAILS - 1) break;
  }
  return out;
}

function roundedRect(w: number, h: number, r: number): string {
  return [
    `M ${N(r)} 0`,
    `H ${N(w - r)}`,
    `A ${N(r)} ${N(r)} 0 0 1 ${N(w)} ${N(r)}`,
    `V ${N(h - r)}`,
    `A ${N(r)} ${N(r)} 0 0 1 ${N(w - r)} ${N(h)}`,
    `H ${N(r)}`,
    `A ${N(r)} ${N(r)} 0 0 1 0 ${N(h - r)}`,
    `V ${N(r)}`,
    `A ${N(r)} ${N(r)} 0 0 1 ${N(r)} 0`,
    "Z",
  ].join(" ");
}

/**
 * 생각 말풍선 본체 — 타원. 꼬리(구름 방울 3단)는 캔버스/SVG 쪽에서 별도 그린다.
 * 메뉴 글리프(StudioBubbleVariantGlyph)와 실루엣을 맞춘다.
 */
export function thoughtBubbleBodyPath(w: number, h: number): string {
  const rx = Math.max(1, w / 2);
  const ry = Math.max(1, h / 2);
  // 두 개의 180° 호로 닫힌 타원(시작=상단 중앙).
  return [
    `M ${N(rx)} 0`,
    `A ${N(rx)} ${N(ry)} 0 1 1 ${N(rx)} ${N(h)}`,
    `A ${N(rx)} ${N(ry)} 0 1 1 ${N(rx)} 0`,
    "Z",
  ].join(" ");
}

/**
 * 소심·공포 말풍선 — 상단 톱니(떨림) 윤곽 + 선택 꼬리를 단일 path로.
 * 메뉴 글리프의 톱니 실루엣을 캔버스/내보내기와 공유한다.
 */
export function scaredBubblePathData(w: number, h: number, tail?: BubbleTailSpec | null): string {
  const ww = Math.max(24, w);
  const hh = Math.max(24, h);
  const amp = Math.min(12, Math.max(5, hh * 0.09));
  const r = Math.min(12, Math.min(ww, hh) * 0.08);
  const peaks = Math.max(5, Math.min(11, Math.round(ww / 28)));
  const TAPER = 0.55;

  // 상단 톱니: y=amp 기준선에서 위아래로 흔들린다(첫·끝은 amp로 모서리 정렬).
  const topPts: { x: number; y: number }[] = [];
  for (let i = 0; i <= peaks; i++) {
    const t = i / peaks;
    const x = r + (ww - r * 2) * t;
    const y = i === 0 || i === peaks ? amp : i % 2 === 1 ? 0 : amp * 1.15;
    topPts.push({ x, y });
  }

  const parts: string[] = [`M ${N(topPts[0].x)} ${N(topPts[0].y)}`];
  for (let i = 1; i < topPts.length; i++) {
    parts.push(`L ${N(topPts[i].x)} ${N(topPts[i].y)}`);
  }

  // 우상 → 우하 라운드
  parts.push(
    `L ${N(ww - r)} ${N(amp)}`,
    `A ${N(r)} ${N(r)} 0 0 1 ${N(ww)} ${N(amp + r)}`,
    `V ${N(hh - r)}`,
    `A ${N(r)} ${N(r)} 0 0 1 ${N(ww - r)} ${N(hh)}`
  );

  const active = tail && tail.length > 0 && tail.base > 0 ? tail : null;
  if (active && (active.direction === "bottom" || active.direction === "top")) {
    // 가로변 꼬리 — speech 규약과 동일한 테이퍼 이차베지어.
    const center = clamp(ww * active.ratio, r + active.base / 2 + 4, ww - r - active.base / 2 - 4);
    const b1 = center - active.base / 2;
    const b2 = center + active.base / 2;
    const sideShift = active.side === "left" ? -active.base * 0.45 : active.side === "right" ? active.base * 0.45 : 0;
    const tip = clamp(center + sideShift, r + 2, ww - r - 2);
    const bend = clamp(active.bend ?? 0, -1, 1) * Math.min(Math.max(active.base, active.length) * 0.42, active.base * 1.4);
    if (active.direction === "bottom") {
      const ty = hh + active.length;
      const cy = hh + active.length * TAPER;
      parts.push(
        `H ${N(b2)}`,
        `Q ${N((b2 + tip) / 2 + bend)} ${N(cy)} ${N(tip)} ${N(ty)}`,
        `Q ${N((tip + b1) / 2 + bend)} ${N(cy)} ${N(b1)} ${N(hh)}`,
        `H ${N(r)}`
      );
    } else {
      // top 꼬리는 톱니 변에 붙이기 어려워 하단 꼬리로 폴백(시각적으로 안정).
      const ty = hh + active.length;
      const cy = hh + active.length * TAPER;
      parts.push(
        `H ${N(b2)}`,
        `Q ${N((b2 + tip) / 2 + bend)} ${N(cy)} ${N(tip)} ${N(ty)}`,
        `Q ${N((tip + b1) / 2 + bend)} ${N(cy)} ${N(b1)} ${N(hh)}`,
        `H ${N(r)}`
      );
    }
  } else if (active && (active.direction === "left" || active.direction === "right")) {
    // 세로변 꼬리는 우/좌 변 중간 구간에서 처리하기 위해 하단 직선 후 별도 삽입이 필요 —
    // 단순화: 하단에 짧은 꼬리로 폴백해 이음새 없는 path를 유지한다.
    const center = clamp(ww * 0.35, r + active.base / 2 + 4, ww - r - active.base / 2 - 4);
    const b1 = center - active.base / 2;
    const b2 = center + active.base / 2;
    const tip = center;
    const ty = hh + active.length;
    const cy = hh + active.length * TAPER;
    parts.push(
      `H ${N(b2)}`,
      `Q ${N((b2 + tip) / 2)} ${N(cy)} ${N(tip)} ${N(ty)}`,
      `Q ${N((tip + b1) / 2)} ${N(cy)} ${N(b1)} ${N(hh)}`,
      `H ${N(r)}`
    );
  } else {
    parts.push(`H ${N(r)}`);
  }

  parts.push(
    `A ${N(r)} ${N(r)} 0 0 1 0 ${N(hh - r)}`,
    `V ${N(amp + r)}`,
    `A ${N(r)} ${N(r)} 0 0 1 ${N(r)} ${N(amp)}`,
    `L ${N(topPts[0].x)} ${N(topPts[0].y)}`,
    "Z"
  );
  return parts.join(" ");
}

/**
 * 하트 말풍선 — viewBox 24×24 기준 표준 path를 요소 크기로 스케일.
 * transform 대신 좌표를 직접 곱해 stroke 두께가 찌그러지지 않게 한다.
 */
export function heartBubblePathData(w: number, h: number): string {
  // Material-style heart in 0..24 space (matches previous Konva path).
  const sx = Math.max(1, w) / 24;
  const sy = Math.max(1, h) / 24;
  const X = (n: number) => N(n * sx);
  const Y = (n: number) => N(n * sy);
  return [
    `M ${X(12)} ${Y(21.35)}`,
    `L ${X(10.55)} ${Y(20.03)}`,
    `C ${X(5.4)} ${Y(15.36)} ${X(2)} ${Y(12.28)} ${X(2)} ${Y(8.5)}`,
    `C ${X(2)} ${Y(5.42)} ${X(4.42)} ${Y(3)} ${X(7.5)} ${Y(3)}`,
    `C ${X(9.24)} ${Y(3)} ${X(10.91)} ${Y(3.81)} ${X(12)} ${Y(5.09)}`,
    `C ${X(13.09)} ${Y(3.81)} ${X(14.76)} ${Y(3)} ${X(16.5)} ${Y(3)}`,
    `C ${X(19.58)} ${Y(3)} ${X(22)} ${Y(5.42)} ${X(22)} ${Y(8.5)}`,
    `C ${X(22)} ${Y(12.28)} ${X(18.6)} ${Y(15.36)} ${X(13.45)} ${Y(20.03)}`,
    `Z`,
  ].join(" ");
}

/* ── 생각풍선 점점이 꼬리 ────────────────────────────────────────────────────
 * 기존에는 캔버스(StudioKonvaBubbleNode)와 SVG export가 각각 고정 오프셋(14/32/54px,
 * 0.26/0.74 지점)을 인라인으로 중복 계산해, 꼬리 손잡이를 끌어도 방울이 따라오지 않는
 * "죽은 손잡이" UX였다. 이 함수 하나로 두 소비처의 기하를 통일하고, tailXRatio/tailHeight가
 * 명시된 경우에만 반응형으로 위치·크기를 조절한다.
 *
 * 하위호환: ratio·length가 모두 undefined(구 문서 기본 상태)이면 기존 고정 배치와 좌표·크기가
 * 정확히 일치한다(렌더 결과 바이트 동일). 새 문서는 손잡이를 끄는 순간 두 값이 커밋되어
 * 방울이 즉시 따라온다.
 */

export interface ThoughtTailDot {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface ThoughtTailDotsInput {
  width: number;
  height: number;
  direction: BubbleTailDirection;
  /** 화자 방향 미러(BubbleEl.tail). "none"은 호출 전에 걸러진다(꼬리 없음). */
  mirror: "left" | "right";
  /** 변 위 위치(0~1). undefined → 레거시 고정 배치(0.26/0.74). */
  ratio?: number;
  /** 꼬리 길이(px, BubbleEl.tailHeight). undefined → 레거시 고정 도달거리(54px). */
  length?: number;
}

/** 레거시 고정 배치의 방울 단계(바깥 축 오프셋·반경) — 도달거리 54px 기준. */
const THOUGHT_DOT_STEPS = [
  { offset: 14, rMajor: 14, rMinor: 11 },
  { offset: 32, rMajor: 10, rMinor: 8 },
  { offset: 54, rMajor: 6, rMinor: 5 },
] as const;
const THOUGHT_LEGACY_REACH = 54;

/**
 * 생각풍선 3단 구름방울 좌표 — 캔버스(Konva Ellipse)와 SVG(<ellipse>)가 공유하는 단일 소스.
 * 가로 변(bottom/top)은 rx=rMajor/ry=rMinor, 세로 변(left/right)은 축이 뒤집힌다.
 */
export function thoughtTailDots(input: ThoughtTailDotsInput): ThoughtTailDot[] {
  const { width: w, height: h, direction, mirror } = input;
  const horizontal = direction === "bottom" || direction === "top";
  const responsive = input.ratio !== undefined || input.length !== undefined;

  // 변 위 주 방울 위치(0~1) — 레거시는 0.26/0.74 고정, 반응형은 tailXRatio를 speech 규약대로
  // (가로 변에서만 화자 미러 반전) 해석한다.
  let big: number;
  if (responsive) {
    const raw = clamp(input.ratio ?? 0.35, 0.1, 0.9);
    big = horizontal && mirror === "right" ? 1 - raw : raw;
  } else {
    big = mirror === "right" ? 0.74 : 0.26;
  }
  // 마지막(가장 작은) 방울은 화자 반대쪽 바깥으로 0.10 만큼 흘러나간다 — 레거시 0.16/0.84 재현.
  const drift = mirror === "right" ? 0.1 : -0.1;
  const small = clamp(big + drift, 0.05, 0.95);

  // 도달거리 — 레거시 54px 고정, 반응형은 tailHeight(기본 30)의 1.8배(30→54로 연속).
  const reach = responsive
    ? clamp((input.length ?? 30) * 1.8, 24, 150)
    : THOUGHT_LEGACY_REACH;
  const sizeScale = clamp(reach / THOUGHT_LEGACY_REACH, 0.55, 1.5);

  const span = horizontal ? w : h;
  const dots: ThoughtTailDot[] = [];
  THOUGHT_DOT_STEPS.forEach((step, index) => {
    const along = span * (index === THOUGHT_DOT_STEPS.length - 1 ? small : big);
    const out = (reach * step.offset) / THOUGHT_LEGACY_REACH;
    const rMajor = step.rMajor * sizeScale;
    const rMinor = step.rMinor * sizeScale;
    if (direction === "bottom") {
      dots.push({ x: along, y: h + out, rx: rMajor, ry: rMinor });
    } else if (direction === "top") {
      dots.push({ x: along, y: -out, rx: rMajor, ry: rMinor });
    } else if (direction === "left") {
      dots.push({ x: -out, y: along, rx: rMinor, ry: rMajor });
    } else {
      dots.push({ x: w + out, y: along, rx: rMinor, ry: rMajor });
    }
  });
  return dots;
}

/* ── 외침/격앙(burst) 변형 파라미터 ─────────────────────────────────────────
 * 캔버스·SVG export·병합 실루엣이 같은 스파이크 수/반경을 쓰도록 단일 소스로 둔다.
 */

export const BURST_STAR_VARIANT_PARAMS = {
  shout: { points: 20, outer: 68, innerRatio: 36 / 68 },
  angry: { points: 22, outer: 64, innerRatio: 28 / 64 },
} as const;

/** 스파이크 수 허용 범위 — 인스펙터 슬라이더와 검증이 공유한다. */
export const BURST_STAR_POINTS_RANGE = { min: 6, max: 40 } as const;

/** 저장 문서의 starPoints를 안전한 정수로 정규화한다(미설정/이상값 → fallback). */
export function normalizeBurstStarPoints(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return clamp(Math.round(raw), BURST_STAR_POINTS_RANGE.min, BURST_STAR_POINTS_RANGE.max);
}

/**
 * 외침/격앙 별 폴리곤 path — Konva Star와 같은 파라미터(numPoints·inner/outer).
 * SVG export / thumbs / 캔버스가 동일 좌표를 쓰도록 순수 함수로 둔다.
 */
export function burstStarPathData(
  w: number,
  h: number,
  numPoints: number,
  innerRadius: number,
  outerRadius: number
): string {
  const cx = w / 2;
  const cy = h / 2;
  const scaleX = w / (outerRadius * 2);
  const scaleY = h / (outerRadius * 2);
  const pts: string[] = [];
  for (let i = 0; i < numPoints * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI * i) / numPoints - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius * scaleX;
    const y = cy + Math.sin(angle) * radius * scaleY;
    pts.push(`${N(x)} ${N(y)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}
