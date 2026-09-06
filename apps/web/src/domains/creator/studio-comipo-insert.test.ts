import { describe, expect, it } from "vitest";

import { CANVAS_W } from "./studio-assets";
import { assembleComipoPage } from "./studio-comipo-assembly";
import {
  collectStudioDecorRefs,
  frameDecorHasNoPairwiseOverlap,
} from "./studio-comipo-incremental";
import { postInsertFramesComposable, type StudioCanvasSnapshot } from "./studio-comipo-insert";
import {
  runStudioPageAddDialogueBubbles,
  runStudioPageAddSceneTemplate,
  studioCanvasSnapshotFromElements,
  studioSpawnCenter,
  type StudioElementLike,
  type StudioPageInsertState,
} from "./studio-comipo-shipped";
import { materializePanelLayout, PANEL_LAYOUTS } from "./studio-panel-layouts";

import type { StudioDecorElement } from "./studio-comipo-incremental";

type TestElement = StudioElementLike & Record<string, unknown>;

const STUDIO_CANVAS_H = 2000;

let idSeq = 0;
function nextId() {
  idSeq += 1;
  return `el-${idSeq}`;
}

function assemblyToElements(layoutId: string): TestElement[] {
  const assembled = assembleComipoPage({ layoutId })!;
  const elements: TestElement[] = [];
  for (const seed of assembled.seeds) {
    const id = nextId();
    if (seed.type === "frame") {
      elements.push({
        id,
        type: "frame",
        x: seed.x,
        y: seed.y,
        width: seed.width,
        height: seed.height,
      });
    } else if (seed.type === "bubble") {
      elements.push({
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
      });
    }
  }
  return elements;
}

/** StudioPage.studioInsertState() 와 동일한 입력 조립. */
function studioPageState(
  elements: TestElement[],
  opts?: {
    canvasH?: number;
    selectedId?: string | null;
    viewCenter?: { x: number; y: number } | null;
  }
): StudioPageInsertState {
  const selectedEl =
    opts?.selectedId != null
      ? elements.find((e) => e.id === opts.selectedId && e.type === "frame")
      : null;
  return {
    elements,
    canvasH: opts?.canvasH ?? STUDIO_CANVAS_H,
    canvasW: CANVAS_W,
    viewCenter: opts?.viewCenter,
    selected:
      selectedEl &&
      selectedEl.x != null &&
      selectedEl.y != null &&
      selectedEl.width != null &&
      selectedEl.height != null
        ? {
            type: "frame",
            x: selectedEl.x,
            y: selectedEl.y,
            width: selectedEl.width,
            height: selectedEl.height,
          }
        : null,
  };
}

function assemblyToSnapshot(layoutId: string): StudioCanvasSnapshot {
  return studioCanvasSnapshotFromElements(assemblyToElements(layoutId));
}

describe("runStudioPageAddSceneTemplate / runStudioPageAddDialogueBubbles", () => {
  const talkLayout = PANEL_LAYOUTS.find((l) => l.id === "layout_talk_2_bubbles")!;
  const top = talkLayout.frames[0]!;

  it("addSceneTemplate: spawnCenter + pickTarget + commit removes layout placeholder", () => {
    const elements = assemblyToElements(talkLayout.id);
    const layoutBubble = elements.find(
      (e) => e.type === "bubble" && e.text === "대사를 입력"
    )!;
    const state = studioPageState(elements, { canvasH: talkLayout.canvasH });

    expect(studioSpawnCenter(state)).toEqual([CANVAS_W / 2, talkLayout.canvasH / 2]);

    const result = runStudioPageAddSceneTemplate(state, "confession", nextId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const snapshot = studioCanvasSnapshotFromElements(result.elements);
    expect(snapshot.decor.some((d) => d.id === layoutBubble.id)).toBe(false);
    expect(postInsertFramesComposable(snapshot.frames, snapshot.decor)).toBe(true);

    const topSeeds = collectStudioDecorRefs(top, snapshot.decor).map((r) => r.seed);
    expect(frameDecorHasNoPairwiseOverlap(top, topSeeds)).toBe(true);
  });

  it("addSceneTemplate: selected frame drives spawnCenter like StudioPage", () => {
    const elements = assemblyToElements(talkLayout.id);
    const frameEl = elements.find((e) => e.type === "frame")!;
    const state = studioPageState(elements, { selectedId: frameEl.id });

    const [cx, cy] = studioSpawnCenter(state);
    expect(cx).toBe(frameEl.x! + frameEl.width! / 2);
    expect(cy).toBe(frameEl.y! + frameEl.height! / 2);

    const result = runStudioPageAddSceneTemplate(state, "confession", nextId);
    expect(result.ok).toBe(true);
  });

  it("addSceneTemplate: current visible center wins over the long document center", () => {
    const state = studioPageState([], {
      canvasH: 6000,
      viewCenter: { x: 360, y: 4200 },
    });

    expect(studioSpawnCenter(state)).toEqual([360, 4200]);
    const result = runStudioPageAddSceneTemplate(state, "confession", nextId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const frame = result.elements.find((element) => element.type === "frame");
    expect(frame?.y).toBe(3970);
  });

  it("addSceneTemplate: clamps a new scene inside the bottom of a long document", () => {
    const state = studioPageState([], {
      canvasH: 6_000,
      viewCenter: { x: 360, y: 5_980 },
    });

    const result = runStudioPageAddSceneTemplate(state, "confession", nextId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const frame = result.elements.find((element) => element.type === "frame");
    expect(frame?.y).toBe(5_516);
    expect((frame?.y ?? 0) + (frame?.height ?? 0)).toBeLessThanOrEqual(5_976);
  });

  it("addSceneTemplate: creates near the current empty work area instead of jumping to the first frame", () => {
    const elements: TestElement[] = [
      { id: "top-frame", type: "frame", x: 24, y: 24, width: 672, height: 480 },
    ];
    const state = studioPageState(elements, {
      canvasH: 6_000,
      viewCenter: { x: 360, y: 4_200 },
    });

    const result = runStudioPageAddSceneTemplate(state, "confession", nextId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const frames = result.elements.filter((element) => element.type === "frame");
    expect(frames).toHaveLength(2);
    expect(frames.some((frame) => frame.y === 3_970)).toBe(true);
  });

  it("addDialogueBubbles: scene then dialogue quickstart stays composable", () => {
    let elements = assemblyToElements(talkLayout.id);
    const scene = runStudioPageAddSceneTemplate(
      studioPageState(elements, { canvasH: talkLayout.canvasH }),
      "confession",
      nextId
    );
    expect(scene.ok).toBe(true);
    if (!scene.ok) return;
    elements = scene.elements as TestElement[];

    const dialogue = runStudioPageAddDialogueBubbles(
      studioPageState(elements, { canvasH: talkLayout.canvasH }),
      "민수: 스튜디오에 오신 걸 환영해요!\n지영: 3D 캐릭터를 써 보세요.",
      nextId
    );
    expect(dialogue.ok).toBe(true);
    if (!dialogue.ok) return;

    const snapshot = studioCanvasSnapshotFromElements(dialogue.elements);
    expect(postInsertFramesComposable(snapshot.frames, snapshot.decor)).toBe(true);
  });

  it("addSceneTemplate: overcrowded selected frame returns ok:false without mutating input", () => {
    const elements: TestElement[] = [
      { id: "f1", type: "frame", x: top.x, y: top.y, width: top.width, height: top.height },
      {
        id: "big-1",
        type: "bubble",
        variant: "speech",
        text: "긴 대사 A",
        x: top.x + 40,
        y: top.y + 40,
        width: 280,
        height: 480,
        fill: "#fff",
        textFill: "#000",
        rotation: 0,
      },
    ];
    const before = structuredClone(elements);
    const result = runStudioPageAddSceneTemplate(
      studioPageState(elements, { selectedId: "f1" }),
      "confession",
      nextId
    );
    expect(result.ok).toBe(false);
    expect(elements).toEqual(before);
  });

  it("addSceneTemplate off-frame: spawnCenter origin blocks pre-existing decor overlap", () => {
    const originY = Math.max(20, Math.round(STUDIO_CANVAS_H / 2 - 240));
    const virtualFrame = { x: 24, y: originY, width: CANVAS_W - 48, height: 480 };
    const elements: TestElement[] = [
      {
        id: "blocker",
        type: "bubble",
        variant: "speech",
        text: "이미 차지",
        x: virtualFrame.x + 40,
        y: virtualFrame.y + 40,
        width: 400,
        height: 400,
        fill: "#fff",
        textFill: "#000",
        rotation: 0,
      },
    ];
    const result = runStudioPageAddSceneTemplate(
      studioPageState(elements, { canvasH: STUDIO_CANVAS_H }),
      "action-impact",
      nextId
    );
    expect(result.ok).toBe(false);
  });

  it("addSceneTemplate off-frame confession: commits frame + decor via spawnCenter", () => {
    const state = studioPageState([], { canvasH: STUDIO_CANVAS_H });
    const result = runStudioPageAddSceneTemplate(state, "confession", nextId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.elements.some((e) => e.type === "frame")).toBe(true);
    const snapshot = studioCanvasSnapshotFromElements(result.elements);
    expect(postInsertFramesComposable(snapshot.frames, snapshot.decor)).toBe(true);
  });

  it("addDialogueBubbles off-frame: empty canvas commits virtual dialogue frame", () => {
    const result = runStudioPageAddDialogueBubbles(
      studioPageState([], { canvasH: STUDIO_CANVAS_H }),
      "민수: 안녕\n지영: 반가워",
      nextId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snapshot = studioCanvasSnapshotFromElements(result.elements);
    expect(snapshot.frames).toHaveLength(1);
    expect(snapshot.decor.length).toBeGreaterThan(0);
    expect(postInsertFramesComposable(snapshot.frames, snapshot.decor)).toBe(true);
  });

  it("addDialogueBubbles: empty script returns ok:false", () => {
    const elements = assemblyToElements(talkLayout.id);
    expect(
      runStudioPageAddDialogueBubbles(studioPageState(elements), "   ", nextId).ok
    ).toBe(false);
  });
});

describe("mutateComipoSnapshot low-level contract", () => {
  const talkLayout = PANEL_LAYOUTS.find((l) => l.id === "layout_talk_2_bubbles")!;

  it("postInsertFramesComposable rejects decor without frames to check", () => {
    const decor: StudioDecorElement[] = [
      {
        id: "solo",
        type: "bubble",
        variant: "speech",
        text: "고아 decor",
        x: 100,
        y: 100,
        width: 120,
        height: 80,
        fill: "#fff",
        textFill: "#000",
        rotation: 0,
      },
    ];
    expect(postInsertFramesComposable([], decor)).toBe(false);
  });

  it("materializePanelLayout seeds remain valid assembly inputs", () => {
    const snapshot = assemblyToSnapshot(talkLayout.id);
    const { seeds } = materializePanelLayout(talkLayout);
    expect(seeds.length).toBeGreaterThan(0);
    expect(snapshot.frames.length).toBeGreaterThan(0);
  });
});
