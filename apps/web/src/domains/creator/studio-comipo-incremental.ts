/**
 * 코미포 증분 삽입 — 캔버스에 이미 있는 프레임 장식 + 신규 시드를 한 배치로
 * placeDecorInFrame 에 넘겨 충돌 없는 전체 상태를 만든다.
 */

import {
  boundsOverlap,
  placeDecorInFrame,
  seedBounds,
  seedCenterInFrame,
  type DecorSeed,
  type DecorSource,
  type PlaceDecorOptions,
  type TaggedDecorSeed,
} from "./studio-comipo-compose";

import type { DialogueBubbleSeed } from "./studio-dialogue";
import type { PanelLayoutFrame } from "./studio-panel-layouts";
import type { SceneSeed } from "./studio-scene-templates";

export interface DecorRef {
  /** 기존 캔버스 요소 id. 신규 삽입분은 undefined. */
  id?: string;
  source: DecorSource;
  seed: DecorSeed;
}

export interface IncrementalPlaceResult {
  composable: boolean;
  /** 배치 후 최종 장식(위치 갱신·id 유지). */
  refs: DecorRef[];
  /** 제거해야 할 기존 요소 id(우선순위 대체·충돌 해소로 탈락). */
  removedIds: string[];
  /** 신규로 추가할 시드(id 없음). */
  addedSeeds: DecorSeed[];
}

const PLACEHOLDER_BUBBLE_TEXTS = new Set(["대사를 입력", "내레이션"]);

/** 캔버스 말풍선/장식의 출처 추정 — dialogue > scene > layout. */
export function inferDecorSource(
  seed: DecorSeed,
  explicit?: DecorSource
): DecorSource {
  if (explicit) return explicit;
  if (seed.type !== "bubble") return "scene";
  if (PLACEHOLDER_BUBBLE_TEXTS.has(seed.text)) return "layout";
  if ("tail" in seed && seed.tail) return "dialogue";
  return "scene";
}

function seedsMatchIdentity(a: DecorSeed, b: DecorSeed): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "bubble" && b.type === "bubble") {
    return a.text === b.text && a.variant === b.variant;
  }
  if (a.type === "text" && b.type === "text") {
    return a.text === b.text;
  }
  if (a.type === "focusLines" && b.type === "focusLines") {
    return a.lineCount === b.lineCount && a.stroke === b.stroke;
  }
  if (a.type === "speedLines" && b.type === "speedLines") {
    return a.lineCount === b.lineCount && a.direction === b.direction;
  }
  return false;
}

/** placeDecorInFrame 결과를 입력 ref 와 대응시킨다(위치는 배치 후 값). */
function matchRefsToPlaced(refs: readonly DecorRef[], placed: readonly DecorSeed[]): DecorRef[] {
  const pool = [...placed];
  const out: DecorRef[] = [];
  for (const ref of refs) {
    const idx = pool.findIndex((p) => seedsMatchIdentity(ref.seed, p));
    if (idx < 0) continue;
    out.push({ ...ref, seed: pool[idx]! });
    pool.splice(idx, 1);
  }
  return out;
}

/**
 * 기존 프레임 장식 + 신규 장식을 합쳐 한 번에 배치한다.
 * composable 이 false 이면 캔버스 commit 을 하지 않아야 한다.
 */
export function incrementalPlaceInFrame(
  frame: PanelLayoutFrame,
  existing: readonly DecorRef[],
  incoming: readonly DecorRef[],
  options?: PlaceDecorOptions
): IncrementalPlaceResult {
  const combined: DecorRef[] = [...existing, ...incoming];
  const tagged: TaggedDecorSeed[] = combined.map((r) => ({ source: r.source, seed: r.seed }));
  const placed = placeDecorInFrame(frame, tagged, options);

  if (!placed.composable) {
    return { composable: false, refs: [], removedIds: [], addedSeeds: [] };
  }

  const surviving = matchRefsToPlaced(combined, placed.placed);
  const survivingIds = new Set(surviving.map((r) => r.id).filter(Boolean));
  const removedIds = existing
    .filter((r) => r.id && !survivingIds.has(r.id))
    .map((r) => r.id!);
  const addedSeeds = surviving.filter((r) => !r.id).map((r) => r.seed);

  return { composable: true, refs: surviving, removedIds, addedSeeds };
}

/** StudioPage 요소 → DecorRef (프레임 밖이면 null). */
export type StudioDecorElement =
  | {
      id: string;
      type: "bubble";
      variant: string;
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      textFill: string;
      rotation: number;
      tail?: "left" | "right" | "none";
      tailDirection?: "bottom" | "top" | "left" | "right";
      align?: "left" | "center" | "right";
    }
  | {
      id: string;
      type: "text";
      text: string;
      x: number;
      y: number;
      width: number;
      fontSize: number;
      fill: string;
      rotation: number;
      font?: string;
      stroke?: string;
      strokeWidth?: number;
      align?: "left" | "center" | "right";
      fontStyle?: "normal" | "bold" | "italic" | "bold italic";
    }
  | {
      id: string;
      type: "focusLines";
      x: number;
      y: number;
      width: number;
      height: number;
      lineCount: number;
      innerRadius: number;
      outerRadius: number;
      stroke: string;
      strokeWidth: number;
      noise?: number;
      rotation: number;
    }
  | {
      id: string;
      type: "speedLines";
      x: number;
      y: number;
      width: number;
      height: number;
      lineCount: number;
      direction: "horizontal" | "vertical";
      stroke: string;
      strokeWidth: number;
      rotation: number;
    };

export function studioElToDecorRef(
  el: StudioDecorElement,
  frame: PanelLayoutFrame
): DecorRef | null {
  let seed: DecorSeed;
  if (el.type === "bubble") {
    seed = {
      type: "bubble",
      variant: el.variant as DialogueBubbleSeed["variant"],
      text: el.text,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      fill: el.fill,
      textFill: el.textFill,
      rotation: el.rotation,
      tail: el.tail,
      tailDirection: el.tailDirection,
      align: el.align,
    };
  } else if (el.type === "text") {
    seed = {
      type: "text",
      text: el.text,
      x: el.x,
      y: el.y,
      width: el.width,
      fontSize: el.fontSize,
      fill: el.fill,
      rotation: el.rotation,
      font: el.font,
      stroke: el.stroke,
      strokeWidth: el.strokeWidth,
      align: el.align,
      fontStyle: el.fontStyle,
    };
  } else if (el.type === "focusLines") {
    seed = {
      type: "focusLines",
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      lineCount: el.lineCount,
      innerRadius: el.innerRadius,
      outerRadius: el.outerRadius,
      stroke: el.stroke,
      strokeWidth: el.strokeWidth,
      noise: el.noise ?? 0,
      rotation: el.rotation,
    };
  } else {
    seed = {
      type: "speedLines",
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      lineCount: el.lineCount,
      direction: el.direction,
      stroke: el.stroke,
      strokeWidth: el.strokeWidth,
      rotation: el.rotation,
    };
  }
  if (!seedCenterInFrame(seed, frame)) return null;
  return { id: el.id, source: inferDecorSource(seed), seed };
}

export function collectStudioDecorRefs(
  frame: PanelLayoutFrame,
  elements: readonly StudioDecorElement[]
): DecorRef[] {
  const refs: DecorRef[] = [];
  for (const el of elements) {
    const ref = studioElToDecorRef(el, frame);
    if (ref) refs.push(ref);
  }
  return refs;
}

/** 장면 템플릿 시드를 증분 삽입용 incoming ref 로 변환. */
export function sceneIncomingRefs(sceneSeeds: readonly SceneSeed[]): DecorRef[] {
  return sceneSeeds.map((seed) => ({
    source: inferDecorSource(seed, "scene"),
    seed,
  }));
}

/** 대사 말풍선 시드를 증분 삽입용 incoming ref 로 변환. */
export function dialogueIncomingRefs(bubbles: readonly DialogueBubbleSeed[]): DecorRef[] {
  return bubbles.map((seed) => ({ source: "dialogue" as const, seed }));
}

export interface IncrementalDecorPatch {
  removedIds: readonly string[];
  updates: ReadonlyArray<{ id: string; seed: DecorSeed }>;
  addedSeeds: readonly DecorSeed[];
}

function patchDecorElement(el: StudioDecorElement, seed: DecorSeed): StudioDecorElement {
  if (el.type === "bubble" && seed.type === "bubble") {
    return {
      ...el,
      x: seed.x,
      y: seed.y,
      width: seed.width,
      height: seed.height,
      text: seed.text,
      variant: seed.variant,
      fill: seed.fill,
      textFill: seed.textFill,
      rotation: seed.rotation,
      tail: seed.tail,
      tailDirection: seed.tailDirection,
      align: seed.align,
    };
  }
  if (el.type === "text" && seed.type === "text") {
    return {
      ...el,
      x: seed.x,
      y: seed.y,
      width: seed.width,
      text: seed.text,
      fontSize: seed.fontSize,
      fill: seed.fill,
      rotation: seed.rotation,
    };
  }
  if (el.type === "focusLines" && seed.type === "focusLines") {
    return {
      ...el,
      x: seed.x,
      y: seed.y,
      width: seed.width,
      height: seed.height,
      rotation: seed.rotation,
    };
  }
  if (el.type === "speedLines" && seed.type === "speedLines") {
    return {
      ...el,
      x: seed.x,
      y: seed.y,
      width: seed.width,
      height: seed.height,
      rotation: seed.rotation,
    };
  }
  return el;
}

function decorSeedToStudioElement(seed: DecorSeed, id: string): StudioDecorElement {
  if (seed.type === "bubble") {
    return {
      id,
      type: "bubble",
      variant: seed.variant,
      text: seed.text,
      x: seed.x,
      y: seed.y,
      width: seed.width,
      height: seed.height,
      fill: seed.fill,
      textFill: seed.textFill,
      rotation: seed.rotation,
      tail: seed.tail,
      tailDirection: seed.tailDirection,
      align: seed.align,
    };
  }
  if (seed.type === "text") {
    return {
      id,
      type: "text",
      text: seed.text,
      x: seed.x,
      y: seed.y,
      width: seed.width,
      fontSize: seed.fontSize,
      fill: seed.fill,
      rotation: seed.rotation,
      font: seed.font,
      stroke: seed.stroke,
      strokeWidth: seed.strokeWidth,
      align: seed.align,
      fontStyle: seed.fontStyle,
    };
  }
  if (seed.type === "focusLines") {
    return {
      id,
      type: "focusLines",
      x: seed.x,
      y: seed.y,
      width: seed.width,
      height: seed.height,
      lineCount: seed.lineCount,
      innerRadius: seed.innerRadius,
      outerRadius: seed.outerRadius,
      stroke: seed.stroke,
      strokeWidth: seed.strokeWidth,
      noise: seed.noise,
      rotation: seed.rotation,
    };
  }
  if (seed.type === "speedLines") {
    return {
      id,
      type: "speedLines",
      x: seed.x,
      y: seed.y,
      width: seed.width,
      height: seed.height,
      lineCount: seed.lineCount,
      direction: seed.direction,
      stroke: seed.stroke,
      strokeWidth: seed.strokeWidth,
      rotation: seed.rotation,
    };
  }
  throw new Error("Unsupported decor seed for studio element");
}

/** 증분 decor 패치를 decor 배열에 적용(mutateComipoSnapshot 내부·commit 전 단계). */
export function applyIncrementalDecor(
  decor: readonly StudioDecorElement[],
  patch: IncrementalDecorPatch,
  createId: () => string
): StudioDecorElement[] {
  const removed = new Set(patch.removedIds);
  const byId = new Map(patch.updates.map((u) => [u.id, u.seed] as const));
  const kept = decor
    .filter((e) => !removed.has(e.id))
    .map((e) => {
      const seed = byId.get(e.id);
      return seed ? patchDecorElement(e, seed) : e;
    });
  const added = patch.addedSeeds.map((seed) => decorSeedToStudioElement(seed, createId()));
  return [...kept, ...added];
}

/** 프레임 내 최종 장식이 쌍별로 겹치지 않는지(증분 commit 후 불변식). */
export function frameDecorHasNoPairwiseOverlap(
  frame: PanelLayoutFrame,
  seeds: readonly DecorSeed[]
): boolean {
  const inFrame = seeds.filter((s) => s.type !== "frame" && seedCenterInFrame(s, frame));
  for (let i = 0; i < inFrame.length; i++) {
    for (let j = i + 1; j < inFrame.length; j++) {
      if (boundsOverlap(seedBounds(inFrame[i]!), seedBounds(inFrame[j]!))) return false;
    }
  }
  return true;
}