/**
 * 코미포·툰스푼식 공간 조립 — 장면/대사 시드를 패널 프레임 안에 맞춰 배치한다.
 * 패널 프레임과 겹치지 않게 하고, 장면 템플릿의 중복 frame 시드는 제거한다.
 */

import { parseDialogueScript, type DialogueBubbleSeed } from "./studio-dialogue";
import { estimateBubbleHeight } from "./studio-fit";

import type { PanelLayoutFrame } from "./studio-panel-layouts";
import type { SceneSeed } from "./studio-scene-templates";

const CANVAS_W = 720;
const FRAME_PAD = 20;

export type ComposeBounds = { x: number; y: number; w: number; h: number };
export type DecorSeed = SceneSeed | DialogueBubbleSeed;
export type DecorSource = "layout" | "scene" | "dialogue";

export interface TaggedDecorSeed {
  seed: DecorSeed;
  source: DecorSource;
}

export interface PlaceDecorOptions {
  gap?: number;
  padding?: number;
}

export interface PlaceDecorResult {
  placed: DecorSeed[];
  composable: boolean;
}

/** 시드의 대략적 bbox (width/height 없는 타입은 최소 크기 추정). */
export function seedBounds(seed: SceneSeed | DialogueBubbleSeed): ComposeBounds {
  if (seed.type === "text") {
    return { x: seed.x, y: seed.y, w: seed.width, h: seed.fontSize * 1.4 };
  }
  if (seed.type === "bubble") {
    return { x: seed.x, y: seed.y, w: seed.width, h: seed.height };
  }
  if (seed.type === "frame") {
    return { x: seed.x, y: seed.y, w: seed.width, h: seed.height };
  }
  if (seed.type === "focusLines" || seed.type === "speedLines") {
    return { x: seed.x, y: seed.y, w: seed.width, h: seed.height };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

export function unionSeedBounds(seeds: readonly (SceneSeed | DialogueBubbleSeed)[]): ComposeBounds | null {
  if (seeds.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seed of seeds) {
    const b = seedBounds(seed);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boundsOverlap(a: ComposeBounds, b: ComposeBounds): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 두 패널 프레임 bbox가 겹치는지. */
export function framesOverlap(frames: readonly PanelLayoutFrame[]): boolean {
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const a = frames[i]!;
      const b = frames[j]!;
      if (
        boundsOverlap(
          { x: a.x, y: a.y, w: a.width, h: a.height },
          { x: b.x, y: b.y, w: b.width, h: b.height }
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function translateSceneSeed(seed: SceneSeed, dx: number, dy: number): SceneSeed {
  return { ...seed, x: seed.x + dx, y: seed.y + dy };
}

function scaleSceneSeed(seed: SceneSeed, scale: number, originX: number, originY: number): SceneSeed {
  const sx = (v: number) => originX + (v - originX) * scale;
  const sy = (v: number) => originY + (v - originY) * scale;
  if (seed.type === "text") {
    return {
      ...seed,
      x: sx(seed.x),
      y: sy(seed.y),
      width: Math.round(seed.width * scale),
      fontSize: Math.max(10, Math.round(seed.fontSize * scale)),
      strokeWidth: seed.strokeWidth != null ? Math.max(1, seed.strokeWidth * scale) : seed.strokeWidth,
    };
  }
  if (seed.type === "bubble") {
    return {
      ...seed,
      x: sx(seed.x),
      y: sy(seed.y),
      width: Math.round(seed.width * scale),
      height: Math.round(seed.height * scale),
    };
  }
  if (seed.type === "focusLines" || seed.type === "speedLines") {
    return {
      ...seed,
      x: sx(seed.x),
      y: sy(seed.y),
      width: Math.round(seed.width * scale),
      height: Math.round(seed.height * scale),
      strokeWidth: Math.max(1, seed.strokeWidth * scale),
      innerRadius: seed.type === "focusLines" ? seed.innerRadius * scale : undefined,
      outerRadius: seed.type === "focusLines" ? seed.outerRadius * scale : undefined,
    } as SceneSeed;
  }
  return seed;
}

/**
 * 장면 템플릿 시드를 대상 패널 프레임 안에 맞춘다.
 * 장면 자체 frame 시드는 제거(패널 프레임 재사용)하고, 나머지를 scale+translate 한다.
 */
export function composeSceneIntoFrame(
  sceneSeeds: readonly SceneSeed[],
  frame: PanelLayoutFrame,
  padding = FRAME_PAD
): SceneSeed[] {
  const decor = sceneSeeds.filter((s) => s.type !== "frame");
  if (decor.length === 0) return [];

  const bbox = unionSeedBounds(decor);
  if (!bbox || bbox.w <= 0 || bbox.h <= 0) return decor;

  const innerW = frame.width - padding * 2;
  const innerH = frame.height - padding * 2;
  const scale = Math.min(1, innerW / bbox.w, innerH / bbox.h);
  const originX = bbox.x;
  const originY = bbox.y;

  const scaled = decor.map((seed) => scaleSceneSeed(seed, scale, originX, originY));
  const scaledBox = unionSeedBounds(scaled);
  if (!scaledBox) return scaled;

  const targetX = frame.x + padding + (innerW - scaledBox.w) / 2;
  const targetY = frame.y + padding + (innerH - scaledBox.h) / 2;
  const dx = targetX - scaledBox.x;
  const dy = targetY - scaledBox.y;

  return scaled.map((seed) => translateSceneSeed(seed, dx, dy));
}

const DIALOGUE_FONT_SIZE = 22;

/** 대사 라인을 프레임 순서대로 배치(한 줄 = 한 프레임, 초과 시 순환). */
export function composeDialogueIntoFrames(
  script: string,
  frames: readonly PanelLayoutFrame[],
  canvasWidth = CANVAS_W
): DialogueBubbleSeed[] {
  const lines = parseDialogueScript(script);
  if (lines.length === 0 || frames.length === 0) return [];

  const margin = 28;
  const gap = 16;
  const speechWidth = Math.round(canvasWidth * 0.5);
  const out: DialogueBubbleSeed[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const frame = frames[i % frames.length]!;
    const innerMargin = Math.min(margin, Math.round(frame.width * 0.08));
    const maxBubbleW = Math.min(speechWidth, frame.width - innerMargin * 2);

    if (line.kind === "narration") {
      const width = frame.width - innerMargin * 2;
      const height = estimateBubbleHeight(line.text, width, DIALOGUE_FONT_SIZE);
      out.push({
        type: "bubble",
        variant: "box",
        text: line.text,
        x: frame.x + innerMargin,
        y: frame.y + innerMargin,
        width,
        height,
        fill: "#1c1c1c",
        textFill: "#f4f4f4",
        rotation: 0,
        align: "center",
      });
      continue;
    }

    const height = estimateBubbleHeight(line.text, maxBubbleW, DIALOGUE_FONT_SIZE);
    const x =
      line.side === "left"
        ? frame.x + innerMargin
        : frame.x + frame.width - innerMargin - maxBubbleW;
    const y = frame.y + innerMargin + gap;

    out.push({
      type: "bubble",
      variant: "speech",
      text: line.text,
      x,
      y,
      width: maxBubbleW,
      height,
      fill: "#ffffff",
      textFill: "#1a1a1a",
      rotation: 0,
      tail: line.side,
      tailDirection: "bottom",
      align: "left",
    });
  }

  return out;
}

/** 시드 중심이 프레임 안에 있는지. */
export function seedCenterInFrame(seed: DecorSeed, frame: PanelLayoutFrame): boolean {
  const b = seedBounds(seed);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return cx >= frame.x && cx <= frame.x + frame.width && cy >= frame.y && cy <= frame.y + frame.height;
}

function decorPriority(tag: TaggedDecorSeed): number {
  if (tag.seed.type === "focusLines" || tag.seed.type === "speedLines") return 1;
  if (tag.seed.type === "text") return 2;
  if (tag.seed.type !== "bubble") return 2;
  if (tag.source === "layout") return 3;
  if (tag.source === "scene") return 4;
  return 5;
}

function winningBubbleSource(sources: ReadonlySet<DecorSource>): DecorSource | null {
  if (sources.has("dialogue")) return "dialogue";
  if (sources.has("scene")) return "scene";
  if (sources.has("layout")) return "layout";
  return null;
}

function moveSeedY(seed: DecorSeed, y: number): DecorSeed {
  return { ...seed, y };
}

/** 프레임 안 장식끼리 bbox가 겹치는지(쌍별 검사). */
export function decorCollidesInFrame(
  frame: PanelLayoutFrame,
  seeds: readonly DecorSeed[]
): boolean {
  const inFrame = seeds.filter((s) => s.type !== "frame" && seedCenterInFrame(s, frame));
  for (let i = 0; i < inFrame.length; i++) {
    for (let j = i + 1; j < inFrame.length; j++) {
      if (boundsOverlap(seedBounds(inFrame[i]!), seedBounds(inFrame[j]!))) return true;
    }
  }
  return false;
}

/**
 * 한 프레임에 들어갈 장식(레이아웃·장면·대사)을 충돌 없이 배치한다.
 * 말풍선은 dialogue > scene > layout 우선순위로 placeholder를 대체하고,
 * 남은 충돌은 낮은 우선순위 요소를 세로로 밀어 해소한다.
 */
export function placeDecorInFrame(
  frame: PanelLayoutFrame,
  tagged: readonly TaggedDecorSeed[],
  options: PlaceDecorOptions = {}
): PlaceDecorResult {
  const gap = options.gap ?? 12;
  const padding = options.padding ?? FRAME_PAD;

  const bubbleSources = new Set(
    tagged.filter((t) => t.seed.type === "bubble").map((t) => t.source)
  );
  const activeBubbleSource = winningBubbleSource(bubbleSources);

  const working: TaggedDecorSeed[] = tagged
    .filter((t) => t.seed.type !== "bubble" || t.source === activeBubbleSource)
    .map((t) => ({ source: t.source, seed: { ...t.seed } }));

  const maxIter = Math.max(1, working.length * 6);
  for (let iter = 0; iter < maxIter; iter++) {
    let hit: [number, number] | null = null;
    for (let i = 0; i < working.length; i++) {
      for (let j = i + 1; j < working.length; j++) {
        if (boundsOverlap(seedBounds(working[i]!.seed), seedBounds(working[j]!.seed))) {
          hit = [i, j];
          break;
        }
      }
      if (hit) break;
    }
    if (!hit) break;

    const [ai, bi] = hit;
    const moveIdx = decorPriority(working[ai]!) <= decorPriority(working[bi]!) ? ai : bi;
    const stayIdx = moveIdx === ai ? bi : ai;
    const move = working[moveIdx]!;
    const stay = working[stayIdx]!;
    const mb = seedBounds(move.seed);
    const sb = seedBounds(stay.seed);

    if (move.seed.type === "bubble") {
      const newY = sb.y + sb.h + gap;
      if (newY + mb.h > frame.y + frame.height - padding) {
        return { placed: working.map((t) => t.seed), composable: false };
      }
      move.seed = moveSeedY(move.seed, newY);
      continue;
    }

    if (move.seed.type === "text") {
      const newY =
        mb.y < sb.y
          ? Math.max(frame.y + padding, sb.y - mb.h - gap)
          : sb.y + sb.h + gap;
      if (newY + mb.h > frame.y + frame.height - padding || newY < frame.y + padding) {
        return { placed: working.map((t) => t.seed), composable: false };
      }
      move.seed = moveSeedY(move.seed, newY);
      continue;
    }

    return { placed: working.map((t) => t.seed), composable: false };
  }

  const placed = working.map((t) => t.seed);
  const composable = seedsFitInsideFrame(placed, frame, 4) && !decorCollidesInFrame(frame, placed);
  return { placed, composable };
}

/** 말풍선/장식 시드가 지정 프레임 안에 완전히 들어가는지. */
export function seedsFitInsideFrame(
  seeds: readonly (SceneSeed | DialogueBubbleSeed)[],
  frame: PanelLayoutFrame,
  slack = 2
): boolean {
  for (const seed of seeds) {
    if (seed.type === "frame") continue;
    const b = seedBounds(seed);
    if (
      b.x < frame.x - slack ||
      b.y < frame.y - slack ||
      b.x + b.w > frame.x + frame.width + slack ||
      b.y + b.h > frame.y + frame.height + slack
    ) {
      return false;
    }
  }
  return true;
}

/** 조립 결과가 '배치 가능한 상태'인지 — 프레임·장식 fit + 프레임 내 장식 쌍별 충돌 없음. */
export function isComposableAssembly(
  frames: readonly PanelLayoutFrame[],
  decorSeeds: readonly DecorSeed[],
  canvasH: number,
  canvasWidth = CANVAS_W
): boolean {
  if (frames.length === 0) return false;
  if (framesOverlap(frames)) return false;
  for (const frame of frames) {
    if (frame.x < 0 || frame.y < 0 || frame.x + frame.width > canvasWidth + 1 || frame.y + frame.height > canvasH + 1) {
      return false;
    }
    const inFrame = decorSeeds.filter((s) => s.type !== "frame" && seedCenterInFrame(s, frame));
    if (!seedsFitInsideFrame(inFrame, frame, 4)) return false;
    if (decorCollidesInFrame(frame, inFrame)) return false;
  }
  for (const seed of decorSeeds) {
    if (seed.type === "frame") continue;
    if (!frames.some((f) => seedsFitInsideFrame([seed], f, 4))) return false;
  }
  return true;
}