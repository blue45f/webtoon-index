import { describe, expect, expectTypeOf, it } from "vitest";

import { layoutScenarioPanels, type ScenarioSceneInput } from "./studio-scenario-layout";
import { SFX_LIBRARY } from "./studio-sfx-presets";
import {
  createEmptyStudioWriterRoomDocument,
  normalizeStudioWriterRoomDocument,
  type StudioWriterRoomBeat,
  type StudioWriterRoomDialogue,
  type StudioWriterRoomDocument,
  type StudioWriterRoomPanel,
  type StudioWriterRoomScene,
  type StudioWriterRoomSfx,
} from "./studio-writer-room";
import {
  STUDIO_WRITER_ROOM_CANVAS_HANDOFF_LIMITS,
  STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS,
  projectStudioWriterRoomToCanvasPlan,
  type StudioWriterRoomCanvasDiagnosticCode,
} from "./studio-writer-room-canvas-projection";

interface DocumentParts {
  beats?: readonly StudioWriterRoomBeat[];
  scenes?: readonly StudioWriterRoomScene[];
  panels?: readonly StudioWriterRoomPanel[];
  dialogue?: readonly StudioWriterRoomDialogue[];
  sfx?: readonly StudioWriterRoomSfx[];
}

const DEFAULT_BEAT: StudioWriterRoomBeat = {
  id: "beat-1",
  order: 1,
  title: "만남",
  summary: "두 사람이 마주친다.",
  characterIds: [],
};

const DEFAULT_SCENE: StudioWriterRoomScene = {
  id: "scene-1",
  order: 1,
  beatIds: ["beat-1"],
  heading: "학교 앞",
  summary: "빗속에서 두 사람이 마주친다.",
  location: "교문",
  time: "방과 후",
  characterIds: [],
};

const DEFAULT_PANEL: StudioWriterRoomPanel = {
  id: "panel-1",
  order: 1,
  sceneId: "scene-1",
  shot: "미디엄 숏",
  action: "우산을 내민다.",
  characterIds: [],
};

function writerRoomDocument(parts: DocumentParts = {}): StudioWriterRoomDocument {
  const empty = createEmptyStudioWriterRoomDocument();
  return normalizeStudioWriterRoomDocument({
    ...empty,
    stages: {
      ...empty.stages,
      beats: { items: (parts.beats ?? [DEFAULT_BEAT]).slice() },
      scenes: { items: (parts.scenes ?? [DEFAULT_SCENE]).slice() },
      "panel-plan": { items: (parts.panels ?? [DEFAULT_PANEL]).slice() },
      "dialogue-sfx": {
        dialogue: (parts.dialogue ?? []).slice(),
        sfx: (parts.sfx ?? []).slice(),
      },
    },
  });
}

function sfx(input: Partial<StudioWriterRoomSfx> & Pick<StudioWriterRoomSfx, "id" | "panelId">): StudioWriterRoomSfx {
  return {
    id: input.id,
    order: input.order ?? 1,
    panelId: input.panelId,
    presetId: input.presetId ?? null,
    customText: input.customText ?? "쿠궁",
    style: input.style ?? { emphasis: "normal", scale: "medium" },
  };
}

function diagnosticCodes(result: {
  diagnostics: readonly { code: StudioWriterRoomCanvasDiagnosticCode }[];
}): StudioWriterRoomCanvasDiagnosticCode[] {
  return result.diagnostics.map(({ code }) => code);
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
}

describe("projectStudioWriterRoomToCanvasPlan", () => {
  it("preserves Writer Room IDs and emits ordered scenario, dialogue, SFX, and scene metadata", () => {
    const preset = SFX_LIBRARY[0];
    expect(preset).toBeDefined();
    const document = writerRoomDocument({
      beats: [DEFAULT_BEAT],
      scenes: [
        {
          ...DEFAULT_SCENE,
          characterIds: ["char-b", "char-a"],
        },
      ],
      panels: [
        {
          id: "panel-2",
          order: 2,
          sceneId: "scene-1",
          shot: "롱 숏",
          action: "두 사람이 교문을 나선다.",
          characterIds: ["char-b"],
        },
        {
          ...DEFAULT_PANEL,
          characterIds: ["char-a"],
        },
      ],
      dialogue: [
        {
          id: "dialogue-2",
          order: 2,
          panelId: "panel-1",
          characterId: null,
          text: "비가 거세진다.",
        },
        {
          id: "dialogue-1",
          order: 1,
          panelId: "panel-1",
          characterId: "char-a",
          text: "같이 갈래?",
        },
      ],
      sfx: [
        sfx({
          id: "sfx-1",
          panelId: "panel-1",
          presetId: preset?.id ?? null,
          customText: "쿠궁",
          style: { emphasis: "strong", scale: "large" },
        }),
      ],
    });

    const result = projectStudioWriterRoomToCanvasPlan(document, {
      characters: [
        { id: "char-a", name: "하린" },
        { id: "char-b", name: "민우" },
      ],
    });

    expect(result.panels.map(({ id }) => id)).toEqual(["panel-1", "panel-2"]);
    expect(result.panels[0]).toMatchObject({
      id: "panel-1",
      sequence: 0,
      sceneId: "scene-1",
      sceneSummary: "빗속에서 두 사람이 마주친다.",
      shot: "미디엄 숏",
      action: "우산을 내민다.",
      declaredCharacterIds: ["char-a"],
      characterIds: ["char-a", "char-b"],
      dialogueScript: "하린: 같이 갈래?\n[비가 거세진다.]",
      empty: false,
    });
    expect(result.panels[0]?.dialogueLines.map(({ id }) => id)).toEqual([
      "dialogue-1",
      "dialogue-2",
    ]);
    expect(result.panels[0]?.sfxLabels[0]).toMatchObject({
      id: "sfx-1",
      presetId: preset?.id,
      presetLabel: preset?.label,
      category: preset?.category,
      text: "쿠궁",
      style: { emphasis: "strong", scale: "large" },
    });
    expect(result.panels[0]?.scene).toMatchObject({
      id: "scene-1",
      beatIds: ["beat-1"],
      location: "교문",
      time: "방과 후",
    });
    expect(result.scenarioScenes[0]).toMatchObject({
      writerRoomPanelId: "panel-1",
      writerRoomSceneId: "scene-1",
      beatType: "transition",
      summary: "우산을 내민다.",
      dialogue: "하린: 같이 갈래?\n[비가 거세진다.]",
      continuity: {
        characterNames: ["하린", "민우"],
        location: "교문",
        time: "방과 후",
      },
    });
    expectTypeOf(result.scenarioScenes).toMatchTypeOf<readonly ScenarioSceneInput[]>();
    expect(layoutScenarioPanels([], 720, 1_080, result.scenarioScenes).panels).toHaveLength(2);
    expect(result.pageGrouping.pages[0]?.panelIds).toEqual(["panel-1", "panel-2"]);
    expect(result.applyReadiness).toMatchObject({ status: "ready", canApply: true });
    expect(result.diagnostics).toEqual([]);
  });

  it("uses stable ID tie-breaks and diagnoses duplicate order values without blocking apply", () => {
    const document = writerRoomDocument({
      beats: [
        { ...DEFAULT_BEAT, id: "beat-b", order: 1 },
        { ...DEFAULT_BEAT, id: "beat-a", order: 1 },
      ],
      scenes: [
        { ...DEFAULT_SCENE, id: "scene-b", order: 1, beatIds: ["beat-b"] },
        { ...DEFAULT_SCENE, id: "scene-a", order: 1, beatIds: ["beat-a"] },
      ],
      panels: [
        { ...DEFAULT_PANEL, id: "panel-b", order: 1, sceneId: "scene-b" },
        { ...DEFAULT_PANEL, id: "panel-a", order: 1, sceneId: "scene-a" },
      ],
      dialogue: [
        { id: "dialogue-b", order: 1, panelId: "panel-a", characterId: null, text: "둘" },
        { id: "dialogue-a", order: 1, panelId: "panel-a", characterId: null, text: "하나" },
      ],
      sfx: [
        sfx({ id: "sfx-b", order: 1, panelId: "panel-a", customText: "둘" }),
        sfx({ id: "sfx-a", order: 1, panelId: "panel-a", customText: "하나" }),
      ],
    });

    const first = projectStudioWriterRoomToCanvasPlan(document);
    const second = projectStudioWriterRoomToCanvasPlan(document);

    expect(first.panels.map(({ id }) => id)).toEqual(["panel-a", "panel-b"]);
    expect(first.panels[0]?.dialogueLines.map(({ id }) => id)).toEqual([
      "dialogue-a",
      "dialogue-b",
    ]);
    expect(first.panels[0]?.sfxLabels.map(({ id }) => id)).toEqual(["sfx-a", "sfx-b"]);
    expect(diagnosticCodes(first)).toEqual([
      "BEAT_ORDER_DUPLICATE",
      "SCENE_ORDER_DUPLICATE",
      "PANEL_ORDER_DUPLICATE",
      "DIALOGUE_ORDER_DUPLICATE",
      "SFX_ORDER_DUPLICATE",
    ]);
    expect(first.applyReadiness).toMatchObject({ canApply: true, errorCount: 0, warningCount: 5 });
    expect(second).toEqual(first);
  });

  it("blocks broken scene, panel, beat, and Character Bible references with precise orphan IDs", () => {
    const document = writerRoomDocument({
      beats: [],
      scenes: [
        {
          ...DEFAULT_SCENE,
          beatIds: ["beat-missing"],
          characterIds: ["char-scene-missing"],
        },
      ],
      panels: [
        {
          ...DEFAULT_PANEL,
          sceneId: "scene-missing",
          characterIds: ["char-panel-missing"],
        },
        {
          ...DEFAULT_PANEL,
          id: "panel-2",
          order: 2,
          sceneId: "",
          action: "빈 장면 참조를 확인한다.",
        },
      ],
      dialogue: [
        {
          id: "dialogue-orphan",
          order: 1,
          panelId: "panel-missing",
          characterId: "char-dialogue-missing",
          text: "어디로 갔지?",
        },
        {
          id: "dialogue-unbound",
          order: 2,
          panelId: "",
          characterId: null,
          text: "연결되지 않은 대사",
        },
      ],
      sfx: [
        sfx({ id: "sfx-orphan", panelId: "panel-missing" }),
        sfx({ id: "sfx-unbound", order: 2, panelId: "" }),
      ],
    });

    const result = projectStudioWriterRoomToCanvasPlan(document, { characters: [] });
    const codes = diagnosticCodes(result);

    expect(codes).toEqual(expect.arrayContaining([
      "SCENE_BEAT_NOT_FOUND",
      "CHARACTER_NOT_FOUND",
      "DIALOGUE_PANEL_ID_MISSING",
      "DIALOGUE_PANEL_NOT_FOUND",
      "SFX_PANEL_ID_MISSING",
      "SFX_PANEL_NOT_FOUND",
      "PANEL_SCENE_NOT_FOUND",
      "PANEL_SCENE_ID_MISSING",
    ]));
    expect(result.orphans).toEqual({
      dialogueIds: ["dialogue-orphan", "dialogue-unbound"],
      sfxIds: ["sfx-orphan", "sfx-unbound"],
    });
    expect(result.diagnostics.find(({ characterId }) => characterId === "char-scene-missing"))
      .toMatchObject({ code: "CHARACTER_NOT_FOUND", sceneId: "scene-1" });
    expect(result.diagnostics.find(({ dialogueId }) => dialogueId === "dialogue-orphan"))
      .toMatchObject({ code: "DIALOGUE_PANEL_NOT_FOUND", referenceId: "panel-missing" });
    expect(result.applyReadiness.status).toBe("blocked");
    expect(result.applyReadiness.blockingDiagnosticCodes).toEqual(expect.arrayContaining([
      "CHARACTER_NOT_FOUND",
      "DIALOGUE_PANEL_ID_MISSING",
      "DIALOGUE_PANEL_NOT_FOUND",
      "SFX_PANEL_ID_MISSING",
      "SFX_PANEL_NOT_FOUND",
      "PANEL_SCENE_NOT_FOUND",
      "PANEL_SCENE_ID_MISSING",
    ]));
  });

  it("distinguishes an absent panel plan from an empty visual panel", () => {
    const noPanels = projectStudioWriterRoomToCanvasPlan(writerRoomDocument({ panels: [] }));
    expect(noPanels.panels).toEqual([]);
    expect(noPanels.pageGrouping.pages).toEqual([]);
    expect(noPanels.applyReadiness).toMatchObject({ status: "blocked", canApply: false });
    expect(diagnosticCodes(noPanels)).toContain("NO_PANELS");

    const emptyPanel = projectStudioWriterRoomToCanvasPlan(writerRoomDocument({
      scenes: [{ ...DEFAULT_SCENE, heading: "", summary: "", location: "", time: "" }],
      panels: [{ ...DEFAULT_PANEL, shot: "", action: "" }],
    }));
    expect(emptyPanel.panels[0]?.empty).toBe(true);
    expect(diagnosticCodes(emptyPanel)).toContain("PANEL_EMPTY");
    expect(emptyPanel.applyReadiness.canApply).toBe(false);
  });

  it("enforces projection, per-panel dialogue, and SFX limits without losing omitted IDs", () => {
    const document = writerRoomDocument({
      panels: [
        DEFAULT_PANEL,
        { ...DEFAULT_PANEL, id: "panel-2", order: 2, action: "다음 패널" },
      ],
      dialogue: [
        { id: "dialogue-1", order: 1, panelId: "panel-1", characterId: null, text: "하나" },
        { id: "dialogue-2", order: 2, panelId: "panel-1", characterId: null, text: "둘" },
        { id: "dialogue-3", order: 3, panelId: "panel-2", characterId: null, text: "셋" },
      ],
      sfx: [
        sfx({ id: "sfx-1", order: 1, panelId: "panel-1" }),
        sfx({ id: "sfx-2", order: 2, panelId: "panel-1" }),
        sfx({ id: "sfx-3", order: 3, panelId: "panel-2" }),
      ],
    });

    const result = projectStudioWriterRoomToCanvasPlan(document, {
      maxProjectedPanels: 1,
      maxDialogueLinesPerPanel: 1,
      maxSfxLabelsPerPanel: 1,
    });

    expect(result.panels.map(({ id }) => id)).toEqual(["panel-1"]);
    expect(result.panels[0]?.dialogueLines.map(({ id }) => id)).toEqual(["dialogue-1"]);
    expect(result.panels[0]?.sfxLabels.map(({ id }) => id)).toEqual(["sfx-1"]);
    expect(result.omitted).toEqual({
      panelIds: ["panel-2"],
      dialogueIds: ["dialogue-2", "dialogue-3"],
      sfxIds: ["sfx-2", "sfx-3"],
    });
    expect(result.handoffReceipt).toEqual({
      status: "limited",
      limitedBy: ["panels", "dialogue-per-panel", "sfx-per-panel"],
      continuation: result.omitted,
    });
    expect(Object.isFrozen(result.handoffReceipt)).toBe(true);
    expect(Object.isFrozen(result.handoffReceipt.continuation)).toBe(true);
    expect(Object.isFrozen(result.omitted.panelIds)).toBe(true);
    expect(Object.isFrozen(result.omitted.dialogueIds)).toBe(true);
    expect(Object.isFrozen(result.omitted.sfxIds)).toBe(true);
    expect(diagnosticCodes(result)).toEqual(expect.arrayContaining([
      "PANEL_PROJECTION_LIMIT_EXCEEDED",
      "PANEL_DIALOGUE_LIMIT_EXCEEDED",
      "PANEL_SFX_LIMIT_EXCEEDED",
    ]));
    expect(result.applyReadiness.canApply).toBe(false);
  });

  it("keeps document totals separate from explicit canvas hand-off backpressure", () => {
    expect(STUDIO_WRITER_ROOM_CANVAS_HANDOFF_LIMITS).toEqual({
      maxProjectedPanelsPerBatch: 500,
      maxDialogueLinesPerPanelPerBatch: 1_000,
      maxSfxLabelsPerPanelPerBatch: 1_000,
    });
    const result = projectStudioWriterRoomToCanvasPlan(writerRoomDocument());
    expect(result.handoffReceipt).toEqual({
      status: "complete",
      limitedBy: [],
      continuation: null,
    });
    expect(Object.isFrozen(result.handoffReceipt)).toBe(true);
  });

  it("prefers scene boundaries when grouping a long vertical flow", () => {
    const document = writerRoomDocument({
      scenes: [
        DEFAULT_SCENE,
        { ...DEFAULT_SCENE, id: "scene-2", order: 2, heading: "버스 안" },
      ],
      panels: [
        DEFAULT_PANEL,
        { ...DEFAULT_PANEL, id: "panel-2", order: 2 },
        { ...DEFAULT_PANEL, id: "panel-3", order: 3, sceneId: "scene-2" },
        { ...DEFAULT_PANEL, id: "panel-4", order: 4, sceneId: "scene-2" },
      ],
    });

    const result = projectStudioWriterRoomToCanvasPlan(document, { maxPanelsPerPage: 3 });

    expect(result.pageGrouping).toMatchObject({
      strategy: "scene-boundary-vertical-flow",
      preserveSceneBoundariesWhenPossible: true,
    });
    expect(result.pageGrouping.pages.map(({ id, panelIds }) => ({ id, panelIds }))).toEqual([
      { id: "writer-room-page-001", panelIds: ["panel-1", "panel-2"] },
      { id: "writer-room-page-002", panelIds: ["panel-3", "panel-4"] },
    ]);
    expect(result.pageGrouping.pages.every((page) => !page.continuesSceneOnNext)).toBe(true);
    expect(diagnosticCodes(result)).not.toContain("SCENE_SPLIT_ACROSS_PAGES");
  });

  it("splits only an overlong scene and marks both sides of every continuation", () => {
    const panels = Array.from({ length: 5 }, (_, index): StudioWriterRoomPanel => ({
      ...DEFAULT_PANEL,
      id: `panel-${index + 1}`,
      order: index + 1,
    }));
    const result = projectStudioWriterRoomToCanvasPlan(writerRoomDocument({ panels }), {
      maxPanelsPerPage: 2,
    });

    expect(result.pageGrouping.pages.map(({ panelIds }) => panelIds)).toEqual([
      ["panel-1", "panel-2"],
      ["panel-3", "panel-4"],
      ["panel-5"],
    ]);
    expect(result.pageGrouping.pages.map((page) => ({
      fromPrevious: page.continuesSceneFromPrevious,
      onNext: page.continuesSceneOnNext,
    }))).toEqual([
      { fromPrevious: false, onNext: true },
      { fromPrevious: true, onNext: true },
      { fromPrevious: true, onNext: false },
    ]);
    expect(diagnosticCodes(result).filter((code) => code === "SCENE_SPLIT_ACROSS_PAGES"))
      .toHaveLength(2);
    expect(result.applyReadiness.canApply).toBe(true);
  });

  it("blocks dialogue that overflows the scenario layout cap and reports a soft page-height overrun", () => {
    const dialogue = Array.from({ length: 18 }, (_, index): StudioWriterRoomDialogue => ({
      id: `dialogue-${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      panelId: "panel-1",
      characterId: null,
      text: `아주 긴 내레이션 ${index + 1} `.repeat(8),
    }));
    const result = projectStudioWriterRoomToCanvasPlan(writerRoomDocument({ dialogue }), {
      minimumPageHeight: 720,
      targetPageHeight: 720,
    });

    expect(result.panels[0]?.estimatedFrameHeight).toBe(900);
    expect(diagnosticCodes(result)).toEqual(expect.arrayContaining([
      "DIALOGUE_LAYOUT_OVERFLOW",
      "PANEL_EXCEEDS_PAGE_HEIGHT_TARGET",
    ]));
    expect(result.pageGrouping.pages[0]).toMatchObject({
      estimatedCanvasHeight: 948,
      exceedsTargetHeight: true,
    });
    expect(result.applyReadiness.canApply).toBe(false);
  });

  it("retains exact multiline dialogue text while emitting a one-line parser-safe scenario line", () => {
    const document = writerRoomDocument({
      dialogue: [
        {
          id: "dialogue-1",
          order: 1,
          panelId: "panel-1",
          characterId: "char-a",
          text: "첫 줄\n둘째 줄",
        },
        {
          id: "dialogue-empty",
          order: 2,
          panelId: "panel-1",
          characterId: null,
          text: "",
        },
      ],
    });
    const result = projectStudioWriterRoomToCanvasPlan(document, {
      characters: [{ id: "char-a", name: "하린" }],
    });

    expect(result.panels[0]?.dialogueLines[0]).toMatchObject({
      id: "dialogue-1",
      text: "첫 줄\n둘째 줄",
      scenarioLine: "하린: 첫 줄 둘째 줄",
    });
    expect(result.panels[0]?.dialogueScript).toBe("하린: 첫 줄 둘째 줄");
    expect(result.panels[0]?.dialogueLines.map(({ id }) => id)).toEqual([
      "dialogue-1",
      "dialogue-empty",
    ]);
    expect(diagnosticCodes(result)).toContain("DIALOGUE_EMPTY");
    expect(result.applyReadiness.canApply).toBe(true);
  });

  it("uses a legacy or current Character Bible value to resolve scenario speaker labels", () => {
    const document = writerRoomDocument({
      dialogue: [{
        id: "dialogue-1",
        order: 1,
        panelId: "panel-1",
        characterId: "char-a",
        text: "바이블의 이름을 사용해.",
      }],
    });
    const result = projectStudioWriterRoomToCanvasPlan(document, {
      characterBible: { characters: [{ id: "char-a", name: "서윤" }] },
    });

    expect(result.settings.characterValidation).toBe("performed");
    expect(result.panels[0]?.dialogueScript).toBe("서윤: 바이블의 이름을 사용해.");
    expect(result.applyReadiness.canApply).toBe(true);
  });

  it("skips character validation only when no roster was supplied", () => {
    const document = writerRoomDocument({
      panels: [{ ...DEFAULT_PANEL, characterIds: ["char-unknown"] }],
    });
    const skipped = projectStudioWriterRoomToCanvasPlan(document);
    const performed = projectStudioWriterRoomToCanvasPlan(document, { characters: [] });

    expect(skipped.settings.characterValidation).toBe("skipped");
    expect(diagnosticCodes(skipped)).not.toContain("CHARACTER_NOT_FOUND");
    expect(skipped.applyReadiness.canApply).toBe(true);
    expect(performed.settings.characterValidation).toBe("performed");
    expect(diagnosticCodes(performed)).toContain("CHARACTER_NOT_FOUND");
    expect(performed.applyReadiness.canApply).toBe(false);
  });

  it("clamps unsafe projection options to published deterministic bounds", () => {
    const result = projectStudioWriterRoomToCanvasPlan(writerRoomDocument(), {
      canvasWidth: 1,
      minimumPageHeight: 1,
      targetPageHeight: 1,
      maxPanelsPerPage: 10_000,
      maxProjectedPanels: 10_000,
      maxDialogueLinesPerPanel: 10_000,
      maxSfxLabelsPerPanel: 10_000,
    });

    expect(result.settings).toMatchObject({
      canvasWidth: STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.minCanvasWidth,
      minimumPageHeight: STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.minMinimumPageHeight,
      targetPageHeight: STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.minTargetPageHeight,
      maxPanelsPerPage: STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxPanelsPerPage,
      maxProjectedPanels: STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxProjectedPanels,
      maxDialogueLinesPerPanel:
        STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxDialogueLinesPerPanel,
      maxSfxLabelsPerPanel: STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxSfxLabelsPerPanel,
    });
  });

  it("caps diagnostics but retains full blocking counts and readiness", () => {
    const characterIds = Array.from({ length: 128 }, (_, index) => `missing-${index}`);
    const panels = Array.from({ length: 4 }, (_, index): StudioWriterRoomPanel => ({
      ...DEFAULT_PANEL,
      id: `panel-${index}`,
      order: index,
      characterIds,
    }));
    const document = writerRoomDocument({
      scenes: [{ ...DEFAULT_SCENE, characterIds }],
      panels,
    });

    const result = projectStudioWriterRoomToCanvasPlan(document, { characters: [] });

    expect(result.diagnostics).toHaveLength(
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxDiagnostics
    );
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.applyReadiness.errorCount).toBe(128 * 5);
    expect(result.applyReadiness.blockingDiagnosticCodes).toContain("CHARACTER_NOT_FOUND");
    expect(result.applyReadiness.canApply).toBe(false);
  });

  it("never mutates a frozen Writer Room document or character roster", () => {
    const document = writerRoomDocument({
      dialogue: [{
        id: "dialogue-1",
        order: 1,
        panelId: "panel-1",
        characterId: "char-a",
        text: "안녕",
      }],
    });
    const characters = [{ id: "char-a", name: "하린" }] as const;
    const documentSnapshot = structuredClone(document);
    const characterSnapshot = structuredClone(characters);
    deepFreeze(document);
    deepFreeze(characters);

    const first = projectStudioWriterRoomToCanvasPlan(document, { characters });
    const second = projectStudioWriterRoomToCanvasPlan(document, { characters });

    expect(document).toEqual(documentSnapshot);
    expect(characters).toEqual(characterSnapshot);
    expect(second).toEqual(first);
  });
});
