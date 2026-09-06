/**
 * Writer Room -> canvas/scenario projection.
 *
 * This module is intentionally pure. It does not edit a Writer Room document, allocate editor
 * element IDs, call an AI provider, or touch browser state. It turns the reviewed planning stages
 * into an ordered, bounded hand-off that `layoutScenarioPanels` can consume, while retaining the
 * Writer Room IDs needed to place dialogue and SFX deliberately in a later UI transaction.
 */

import {
  normalizeStudioCharacterBible,
  type StudioCharacterBibleEntry,
} from "./studio-character-bible";
import {
  layoutScenarioPanels,
  type ScenarioSceneInput,
} from "./studio-scenario-layout";
import { SFX_LIBRARY, type SfxCategory } from "./studio-sfx-presets";
import {
  normalizeStudioWriterRoomDocument,
  type StudioWriterRoomDialogue,
  type StudioWriterRoomDocument,
  type StudioWriterRoomPanel,
  type StudioWriterRoomScene,
  type StudioWriterRoomSfx,
} from "./studio-writer-room";

export const STUDIO_WRITER_ROOM_CANVAS_PROJECTION_VERSION = 1 as const;

/**
 * Per hand-off/render batch backpressure. These are not Writer Room document-total authority:
 * omitted IDs are returned in a typed limited receipt so a caller can continue explicitly.
 */
export const STUDIO_WRITER_ROOM_CANVAS_HANDOFF_LIMITS = {
  maxProjectedPanelsPerBatch: 500,
  maxDialogueLinesPerPanelPerBatch: 1_000,
  maxSfxLabelsPerPanelPerBatch: 1_000,
} as const;

export const STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS = {
  defaultCanvasWidth: 720,
  minCanvasWidth: 320,
  maxCanvasWidth: 4_096,
  defaultMinimumPageHeight: 1_080,
  minMinimumPageHeight: 720,
  maxMinimumPageHeight: 30_000,
  defaultTargetPageHeight: 8_000,
  minTargetPageHeight: 720,
  maxTargetPageHeight: 30_000,
  defaultMaxPanelsPerPage: 12,
  maxPanelsPerPage: 100,
  maxProjectedPanels: STUDIO_WRITER_ROOM_CANVAS_HANDOFF_LIMITS.maxProjectedPanelsPerBatch,
  maxDialogueLinesPerPanel:
    STUDIO_WRITER_ROOM_CANVAS_HANDOFF_LIMITS.maxDialogueLinesPerPanelPerBatch,
  maxSfxLabelsPerPanel:
    STUDIO_WRITER_ROOM_CANVAS_HANDOFF_LIMITS.maxSfxLabelsPerPanelPerBatch,
  maxDiagnostics: 500,
} as const;

export type StudioWriterRoomCanvasDiagnosticSeverity = "error" | "warning";

export type StudioWriterRoomCanvasDiagnosticCode =
  | "NO_PANELS"
  | "BEAT_ORDER_DUPLICATE"
  | "SCENE_ORDER_DUPLICATE"
  | "PANEL_ORDER_DUPLICATE"
  | "DIALOGUE_ORDER_DUPLICATE"
  | "SFX_ORDER_DUPLICATE"
  | "SCENE_BEAT_NOT_FOUND"
  | "PANEL_SCENE_ID_MISSING"
  | "PANEL_SCENE_NOT_FOUND"
  | "DIALOGUE_PANEL_ID_MISSING"
  | "DIALOGUE_PANEL_NOT_FOUND"
  | "SFX_PANEL_ID_MISSING"
  | "SFX_PANEL_NOT_FOUND"
  | "CHARACTER_NOT_FOUND"
  | "PANEL_EMPTY"
  | "DIALOGUE_EMPTY"
  | "PANEL_PROJECTION_LIMIT_EXCEEDED"
  | "PANEL_DIALOGUE_LIMIT_EXCEEDED"
  | "PANEL_SFX_LIMIT_EXCEEDED"
  | "DIALOGUE_LAYOUT_OVERFLOW"
  | "PANEL_EXCEEDS_PAGE_HEIGHT_TARGET"
  | "SCENE_SPLIT_ACROSS_PAGES";

export interface StudioWriterRoomCanvasDiagnostic {
  severity: StudioWriterRoomCanvasDiagnosticSeverity;
  code: StudioWriterRoomCanvasDiagnosticCode;
  message: string;
  path: string;
  panelId?: string;
  sceneId?: string;
  beatId?: string;
  dialogueId?: string;
  sfxId?: string;
  characterId?: string;
  referenceId?: string;
}

export interface StudioWriterRoomCanvasCharacter {
  id: string;
  name?: string;
}

export interface StudioWriterRoomCanvasProjectionOptions {
  /** Supplying a roster enables missing-character diagnostics. Omitting both rosters skips them. */
  characters?: readonly StudioWriterRoomCanvasCharacter[];
  /** A current or legacy Character Bible value. `characters` takes precedence when both exist. */
  characterBible?: unknown;
  canvasWidth?: number;
  minimumPageHeight?: number;
  targetPageHeight?: number;
  maxPanelsPerPage?: number;
  maxProjectedPanels?: number;
  maxDialogueLinesPerPanel?: number;
  maxSfxLabelsPerPanel?: number;
}

export interface StudioWriterRoomCanvasProjectionSettings {
  canvasWidth: number;
  minimumPageHeight: number;
  targetPageHeight: number;
  maxPanelsPerPage: number;
  maxProjectedPanels: number;
  maxDialogueLinesPerPanel: number;
  maxSfxLabelsPerPanel: number;
  characterValidation: "performed" | "skipped";
}

export interface StudioWriterRoomCanvasScene {
  id: string;
  order: number;
  beatIds: readonly string[];
  heading: string;
  summary: string;
  location: string;
  time: string;
  characterIds: readonly string[];
}

export interface StudioWriterRoomCanvasDialogueLine {
  id: string;
  order: number;
  panelId: string;
  characterId: string | null;
  /** Short, parser-safe display label used only in the generated scenario mini script. */
  speakerLabel: string | null;
  /** Exact normalized Writer Room text. */
  text: string;
  /** One-line representation used by `studio-dialogue.parseDialogueScript`. */
  scenarioLine: string;
}

export interface StudioWriterRoomCanvasSfxLabel {
  id: string;
  order: number;
  panelId: string;
  presetId: string | null;
  presetLabel: string | null;
  category: SfxCategory | null;
  /** Custom text wins; otherwise this is the current preset text. */
  text: string;
  style: {
    emphasis: StudioWriterRoomSfx["style"]["emphasis"];
    scale: StudioWriterRoomSfx["style"]["scale"];
  };
}

export interface StudioWriterRoomScenarioInput extends ScenarioSceneInput {
  /** Stable correlation IDs ignored by `layoutScenarioPanels` but useful to the apply transaction. */
  writerRoomPanelId: string;
  writerRoomSceneId: string | null;
}

export interface StudioWriterRoomCanvasPanelProjection {
  id: string;
  order: number;
  sequence: number;
  sceneId: string;
  scene: StudioWriterRoomCanvasScene | null;
  sceneSummary: string;
  shot: string;
  action: string;
  declaredCharacterIds: readonly string[];
  /** Stable union of scene, panel, and speaking-character references. */
  characterIds: readonly string[];
  dialogueLines: readonly StudioWriterRoomCanvasDialogueLine[];
  dialogueScript: string;
  sfxLabels: readonly StudioWriterRoomCanvasSfxLabel[];
  scenario: StudioWriterRoomScenarioInput;
  estimatedFrameHeight: number;
  empty: boolean;
}

export interface StudioWriterRoomCanvasPageGroup {
  id: string;
  index: number;
  panelIds: readonly string[];
  sceneIds: readonly string[];
  scenarioScenes: readonly StudioWriterRoomScenarioInput[];
  estimatedCanvasHeight: number;
  exceedsTargetHeight: boolean;
  continuesSceneFromPrevious: boolean;
  continuesSceneOnNext: boolean;
}

export interface StudioWriterRoomCanvasPageGrouping {
  strategy: "scene-boundary-vertical-flow";
  preserveSceneBoundariesWhenPossible: true;
  pages: readonly StudioWriterRoomCanvasPageGroup[];
}

export interface StudioWriterRoomCanvasApplyReadiness {
  status: "ready" | "blocked";
  canApply: boolean;
  blockingDiagnosticCodes: readonly StudioWriterRoomCanvasDiagnosticCode[];
  errorCount: number;
  warningCount: number;
}

export interface StudioWriterRoomCanvasHandoffContinuation {
  panelIds: readonly string[];
  dialogueIds: readonly string[];
  sfxIds: readonly string[];
}

export type StudioWriterRoomCanvasHandoffReceipt =
  | Readonly<{
      status: "complete";
      limitedBy: readonly [];
      continuation: null;
    }>
  | Readonly<{
      status: "limited";
      limitedBy: readonly ("panels" | "dialogue-per-panel" | "sfx-per-panel")[];
      continuation: StudioWriterRoomCanvasHandoffContinuation;
    }>;

export interface StudioWriterRoomCanvasProjectionResult {
  version: typeof STUDIO_WRITER_ROOM_CANVAS_PROJECTION_VERSION;
  settings: StudioWriterRoomCanvasProjectionSettings;
  panels: readonly StudioWriterRoomCanvasPanelProjection[];
  /** Flat ordered input accepted directly by `layoutScenarioPanels`. */
  scenarioScenes: readonly StudioWriterRoomScenarioInput[];
  pageGrouping: StudioWriterRoomCanvasPageGrouping;
  diagnostics: readonly StudioWriterRoomCanvasDiagnostic[];
  diagnosticsTruncated: boolean;
  applyReadiness: StudioWriterRoomCanvasApplyReadiness;
  /** Explicit receipt for the bounded hand-off; `limited` always carries every deferred ID. */
  handoffReceipt: StudioWriterRoomCanvasHandoffReceipt;
  omitted: {
    panelIds: readonly string[];
    dialogueIds: readonly string[];
    sfxIds: readonly string[];
  };
  orphans: {
    dialogueIds: readonly string[];
    sfxIds: readonly string[];
  };
}

interface DiagnosticCollector {
  diagnostics: StudioWriterRoomCanvasDiagnostic[];
  totalCount: number;
  errorCount: number;
  warningCount: number;
  blockingCodes: Set<StudioWriterRoomCanvasDiagnosticCode>;
}

interface CharacterRoster {
  validation: "performed" | "skipped";
  byId: Map<string, StudioWriterRoomCanvasCharacter>;
}

interface GroupingDraft {
  panels: StudioWriterRoomCanvasPanelProjection[];
}

const SFX_PRESETS_BY_ID = new Map(SFX_LIBRARY.map((preset) => [preset.id, preset]));

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const candidate = typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
  return Math.max(minimum, Math.min(maximum, candidate));
}

function projectionSettings(
  options: StudioWriterRoomCanvasProjectionOptions
): StudioWriterRoomCanvasProjectionSettings {
  const minimumPageHeight = boundedInteger(
    options.minimumPageHeight,
    STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.defaultMinimumPageHeight,
    STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.minMinimumPageHeight,
    STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxMinimumPageHeight
  );
  const targetPageHeight = boundedInteger(
    options.targetPageHeight,
    STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.defaultTargetPageHeight,
    Math.max(
      minimumPageHeight,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.minTargetPageHeight
    ),
    STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxTargetPageHeight
  );
  return {
    canvasWidth: boundedInteger(
      options.canvasWidth,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.defaultCanvasWidth,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.minCanvasWidth,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxCanvasWidth
    ),
    minimumPageHeight,
    targetPageHeight,
    maxPanelsPerPage: boundedInteger(
      options.maxPanelsPerPage,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.defaultMaxPanelsPerPage,
      1,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxPanelsPerPage
    ),
    maxProjectedPanels: boundedInteger(
      options.maxProjectedPanels,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxProjectedPanels,
      1,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxProjectedPanels
    ),
    maxDialogueLinesPerPanel: boundedInteger(
      options.maxDialogueLinesPerPanel,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxDialogueLinesPerPanel,
      1,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxDialogueLinesPerPanel
    ),
    maxSfxLabelsPerPanel: boundedInteger(
      options.maxSfxLabelsPerPanel,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxSfxLabelsPerPanel,
      1,
      STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxSfxLabelsPerPanel
    ),
    characterValidation:
      options.characters !== undefined || options.characterBible !== undefined
        ? "performed"
        : "skipped",
  };
}

function createDiagnosticCollector(): DiagnosticCollector {
  return {
    diagnostics: [],
    totalCount: 0,
    errorCount: 0,
    warningCount: 0,
    blockingCodes: new Set(),
  };
}

function addDiagnostic(
  collector: DiagnosticCollector,
  diagnostic: StudioWriterRoomCanvasDiagnostic
): void {
  collector.totalCount += 1;
  if (diagnostic.severity === "error") {
    collector.errorCount += 1;
    collector.blockingCodes.add(diagnostic.code);
  } else {
    collector.warningCount += 1;
  }
  if (
    collector.diagnostics.length <
    STUDIO_WRITER_ROOM_CANVAS_PROJECTION_LIMITS.maxDiagnostics
  ) {
    collector.diagnostics.push(diagnostic);
  }
}

function normalizeCharacters(options: StudioWriterRoomCanvasProjectionOptions): CharacterRoster {
  if (options.characters === undefined && options.characterBible === undefined) {
    return { validation: "skipped", byId: new Map() };
  }
  const candidates: readonly StudioWriterRoomCanvasCharacter[] = options.characters ??
    normalizeStudioCharacterBible(options.characterBible).characters.map(
      ({ id, name }: StudioCharacterBibleEntry) => ({ id, name })
    );
  const byId = new Map<string, StudioWriterRoomCanvasCharacter>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.id !== "string") continue;
    const id = candidate.id.trim();
    if (!id || byId.has(id)) continue;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    byId.set(id, name ? { id, name } : { id });
  }
  return { validation: "performed", byId };
}

function orderedUnique(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function diagnoseDuplicateOrders<T extends { id: string; order: number }>(
  items: readonly T[],
  collector: DiagnosticCollector,
  code: StudioWriterRoomCanvasDiagnosticCode,
  path: string,
  context: (item: T) => Partial<StudioWriterRoomCanvasDiagnostic> = () => ({})
): void {
  const firstIdByOrder = new Map<number, string>();
  items.forEach((item, index) => {
    const firstId = firstIdByOrder.get(item.order);
    if (firstId === undefined) {
      firstIdByOrder.set(item.order, item.id);
      return;
    }
    addDiagnostic(collector, {
      severity: "warning",
      code,
      message: "같은 순서 값이 중복되어 ID 오름차순으로 안정적으로 정렬했어요.",
      path: `${path}[${index}].order`,
      referenceId: firstId,
      ...context(item),
    });
  });
}

function diagnoseMissingCharacterIds(
  characterIds: readonly string[],
  path: string,
  roster: CharacterRoster,
  collector: DiagnosticCollector,
  context: Partial<StudioWriterRoomCanvasDiagnostic>
): void {
  if (roster.validation === "skipped") return;
  characterIds.forEach((characterId, index) => {
    if (roster.byId.has(characterId)) return;
    addDiagnostic(collector, {
      severity: "error",
      code: "CHARACTER_NOT_FOUND",
      message: "캐릭터 바이블에서 참조한 캐릭터를 찾을 수 없어요.",
      path: `${path}[${index}]`,
      characterId,
      ...context,
    });
  });
}

function cloneScene(scene: StudioWriterRoomScene): StudioWriterRoomCanvasScene {
  return {
    id: scene.id,
    order: scene.order,
    beatIds: scene.beatIds.slice(),
    heading: scene.heading,
    summary: scene.summary,
    location: scene.location,
    time: scene.time,
    characterIds: scene.characterIds.slice(),
  };
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function speakerLabel(characterId: string, roster: CharacterRoster): string {
  const preferred = roster.byId.get(characterId)?.name || characterId;
  return oneLine(oneLine(preferred).replace(/[:：]/gu, " ")).slice(0, 16) || "화자";
}

function projectDialogueLine(
  dialogue: StudioWriterRoomDialogue,
  roster: CharacterRoster
): StudioWriterRoomCanvasDialogueLine {
  const text = dialogue.text;
  const layoutText = oneLine(text);
  const label = dialogue.characterId ? speakerLabel(dialogue.characterId, roster) : null;
  return {
    id: dialogue.id,
    order: dialogue.order,
    panelId: dialogue.panelId,
    characterId: dialogue.characterId,
    speakerLabel: label,
    text,
    scenarioLine: layoutText
      ? label
        ? `${label}: ${layoutText}`
        : `[${layoutText}]`
      : "",
  };
}

function projectSfx(sfx: StudioWriterRoomSfx): StudioWriterRoomCanvasSfxLabel {
  const preset = sfx.presetId ? SFX_PRESETS_BY_ID.get(sfx.presetId) : undefined;
  return {
    id: sfx.id,
    order: sfx.order,
    panelId: sfx.panelId,
    presetId: sfx.presetId,
    presetLabel: preset?.label ?? null,
    category: preset?.category ?? null,
    text: sfx.customText || preset?.text || "",
    style: { ...sfx.style },
  };
}

function scenarioImagePrompt(
  panel: StudioWriterRoomPanel,
  scene: StudioWriterRoomScene | undefined,
  characterIds: readonly string[],
  roster: CharacterRoster
): string {
  const characterLabels = characterIds.map(
    (characterId) => roster.byId.get(characterId)?.name || characterId
  );
  return [
    scene?.heading,
    scene?.location ? `장소: ${scene.location}` : "",
    scene?.time ? `시간: ${scene.time}` : "",
    panel.shot ? `구도: ${panel.shot}` : "",
    panel.action,
    characterLabels.length > 0 ? `등장인물: ${characterLabels.join(", ")}` : "",
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function scenarioInputForPanel(input: {
  panel: StudioWriterRoomPanel;
  scene?: StudioWriterRoomScene;
  characterIds: readonly string[];
  dialogueScript: string;
  sfxLabels: readonly StudioWriterRoomCanvasSfxLabel[];
  roster: CharacterRoster;
}): StudioWriterRoomScenarioInput {
  const { panel, scene, characterIds, dialogueScript, sfxLabels, roster } = input;
  const fallbackSfx = sfxLabels.map(({ text }) => text).filter(Boolean).join(" ");
  const summary =
    panel.action || scene?.summary || panel.shot || scene?.heading || fallbackSfx || `패널 ${panel.id}`;
  const characterNames = characterIds.map(
    (characterId) => roster.byId.get(characterId)?.name || characterId
  );
  const continuity = scene
    ? {
        ...(characterNames.length > 0 ? { characterNames } : {}),
        ...(scene.location ? { location: scene.location } : {}),
        ...(scene.time ? { time: scene.time } : {}),
      }
    : characterNames.length > 0
      ? { characterNames }
      : undefined;
  return {
    writerRoomPanelId: panel.id,
    writerRoomSceneId: scene?.id ?? null,
    beatType: "transition",
    summary,
    imagePrompt: scenarioImagePrompt(panel, scene, characterIds, roster),
    dialogue: dialogueScript,
    ...(continuity ? { continuity } : {}),
  };
}

function cloneScenarioInput(
  scenario: StudioWriterRoomScenarioInput
): StudioWriterRoomScenarioInput {
  return {
    writerRoomPanelId: scenario.writerRoomPanelId,
    writerRoomSceneId: scenario.writerRoomSceneId,
    beatType: scenario.beatType,
    summary: scenario.summary,
    imagePrompt: scenario.imagePrompt,
    dialogue: scenario.dialogue,
    ...(scenario.continuity
      ? {
          continuity: {
            ...scenario.continuity,
            ...(scenario.continuity.characterNames
              ? { characterNames: scenario.continuity.characterNames.slice() }
              : {}),
          },
        }
      : {}),
  };
}

function estimatedFlowHeight(
  panels: readonly StudioWriterRoomCanvasPanelProjection[],
  settings: StudioWriterRoomCanvasProjectionSettings,
  useMinimumPageHeight: boolean
): number {
  return layoutScenarioPanels(
    [],
    settings.canvasWidth,
    useMinimumPageHeight ? settings.minimumPageHeight : 0,
    panels.map(({ scenario }) => scenario)
  ).nextCanvasH;
}

function panelsFitPage(
  panels: readonly StudioWriterRoomCanvasPanelProjection[],
  settings: StudioWriterRoomCanvasProjectionSettings
): boolean {
  return (
    panels.length <= settings.maxPanelsPerPage &&
    estimatedFlowHeight(panels, settings, false) <= settings.targetPageHeight
  );
}

function contiguousSceneRuns(
  panels: readonly StudioWriterRoomCanvasPanelProjection[]
): StudioWriterRoomCanvasPanelProjection[][] {
  const runs: StudioWriterRoomCanvasPanelProjection[][] = [];
  for (const panel of panels) {
    const previous = runs.at(-1);
    const previousPanel = previous?.at(-1);
    const sameKnownScene =
      previousPanel !== undefined &&
      panel.sceneId.length > 0 &&
      previousPanel.sceneId === panel.sceneId;
    if (previous && sameKnownScene) previous.push(panel);
    else runs.push([panel]);
  }
  return runs;
}

function splitRunIntoPageDrafts(
  run: readonly StudioWriterRoomCanvasPanelProjection[],
  settings: StudioWriterRoomCanvasProjectionSettings
): GroupingDraft[] {
  const drafts: GroupingDraft[] = [];
  let current: StudioWriterRoomCanvasPanelProjection[] = [];
  for (const panel of run) {
    const candidate = [...current, panel];
    if (current.length > 0 && !panelsFitPage(candidate, settings)) {
      drafts.push({ panels: current });
      current = [panel];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) drafts.push({ panels: current });
  return drafts;
}

function groupPages(
  panels: readonly StudioWriterRoomCanvasPanelProjection[],
  settings: StudioWriterRoomCanvasProjectionSettings,
  collector: DiagnosticCollector
): StudioWriterRoomCanvasPageGrouping {
  const drafts: GroupingDraft[] = [];
  let current: StudioWriterRoomCanvasPanelProjection[] = [];

  for (const run of contiguousSceneRuns(panels)) {
    const candidate = [...current, ...run];
    if (panelsFitPage(candidate, settings)) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      drafts.push({ panels: current });
    }
    if (panelsFitPage(run, settings)) {
      current = run.slice();
      continue;
    }
    const splitDrafts = splitRunIntoPageDrafts(run, settings);
    drafts.push(...splitDrafts.slice(0, -1));
    current = splitDrafts.at(-1)?.panels ?? [];
  }
  if (current.length > 0) drafts.push({ panels: current });

  const pages: StudioWriterRoomCanvasPageGroup[] = drafts.map((draft, index) => {
    const flowHeight = estimatedFlowHeight(draft.panels, settings, false);
    const previousLast = drafts[index - 1]?.panels.at(-1);
    const currentFirst = draft.panels[0];
    const currentLast = draft.panels.at(-1);
    const nextFirst = drafts[index + 1]?.panels[0];
    const continuesSceneFromPrevious = Boolean(
      currentFirst?.sceneId && previousLast?.sceneId === currentFirst.sceneId
    );
    const continuesSceneOnNext = Boolean(
      currentLast?.sceneId && nextFirst?.sceneId === currentLast.sceneId
    );
    return {
      id: `writer-room-page-${String(index + 1).padStart(3, "0")}`,
      index,
      panelIds: draft.panels.map(({ id }) => id),
      sceneIds: orderedUnique(draft.panels.map(({ sceneId }) => sceneId)),
      scenarioScenes: draft.panels.map(({ scenario }) => cloneScenarioInput(scenario)),
      estimatedCanvasHeight: Math.max(settings.minimumPageHeight, flowHeight),
      exceedsTargetHeight: flowHeight > settings.targetPageHeight,
      continuesSceneFromPrevious,
      continuesSceneOnNext,
    };
  });

  pages.forEach((page) => {
    if (page.exceedsTargetHeight) {
      const panelId = page.panelIds[0];
      addDiagnostic(collector, {
        severity: "warning",
        code: "PANEL_EXCEEDS_PAGE_HEIGHT_TARGET",
        message: "패널 하나가 페이지 목표 높이보다 커서 단독 페이지로 유지했어요.",
        path: `pageGrouping.pages[${page.index}]`,
        ...(panelId ? { panelId } : {}),
      });
    }
    if (page.continuesSceneOnNext) {
      const sceneId = page.sceneIds.at(-1);
      addDiagnostic(collector, {
        severity: "warning",
        code: "SCENE_SPLIT_ACROSS_PAGES",
        message: "장면이 페이지 높이 또는 패널 수 한도를 넘어 다음 페이지로 이어져요.",
        path: `pageGrouping.pages[${page.index}]`,
        ...(sceneId ? { sceneId } : {}),
      });
    }
  });

  return {
    strategy: "scene-boundary-vertical-flow",
    preserveSceneBoundariesWhenPossible: true,
    pages,
  };
}

function groupByPanelId<T extends { panelId: string; id: string; order: number }>(
  items: readonly T[]
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const group = result.get(item.panelId) ?? [];
    group.push(item);
    result.set(item.panelId, group);
  }
  for (const group of result.values()) {
    group.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }
  return result;
}

function diagnoseSourceReferences(input: {
  document: StudioWriterRoomDocument;
  roster: CharacterRoster;
  collector: DiagnosticCollector;
}): { orphanDialogueIds: string[]; orphanSfxIds: string[] } {
  const { document, roster, collector } = input;
  const beatIds = new Set(document.stages.beats.items.map(({ id }) => id));
  const panelIds = new Set(document.stages["panel-plan"].items.map(({ id }) => id));

  diagnoseDuplicateOrders(
    document.stages.beats.items,
    collector,
    "BEAT_ORDER_DUPLICATE",
    "stages.beats.items",
    ({ id: beatId }) => ({ beatId })
  );
  diagnoseDuplicateOrders(
    document.stages.scenes.items,
    collector,
    "SCENE_ORDER_DUPLICATE",
    "stages.scenes.items",
    ({ id: sceneId }) => ({ sceneId })
  );
  diagnoseDuplicateOrders(
    document.stages["panel-plan"].items,
    collector,
    "PANEL_ORDER_DUPLICATE",
    "stages.panel-plan.items",
    ({ id: panelId }) => ({ panelId })
  );

  document.stages.scenes.items.forEach((scene, sceneIndex) => {
    scene.beatIds.forEach((beatId, beatIndex) => {
      if (beatIds.has(beatId)) return;
      addDiagnostic(collector, {
        severity: "warning",
        code: "SCENE_BEAT_NOT_FOUND",
        message: "장면이 참조한 비트를 찾을 수 없어 캔버스에는 비트 정보 없이 전달해요.",
        path: `stages.scenes.items[${sceneIndex}].beatIds[${beatIndex}]`,
        sceneId: scene.id,
        beatId,
      });
    });
    diagnoseMissingCharacterIds(
      scene.characterIds,
      `stages.scenes.items[${sceneIndex}].characterIds`,
      roster,
      collector,
      { sceneId: scene.id }
    );
  });

  const orphanDialogueIds: string[] = [];
  document.stages["dialogue-sfx"].dialogue.forEach((dialogue, dialogueIndex) => {
    if (!dialogue.panelId) {
      orphanDialogueIds.push(dialogue.id);
      addDiagnostic(collector, {
        severity: "error",
        code: "DIALOGUE_PANEL_ID_MISSING",
        message: "대사를 배치할 패널 ID가 비어 있어요.",
        path: `stages.dialogue-sfx.dialogue[${dialogueIndex}].panelId`,
        dialogueId: dialogue.id,
      });
    } else if (!panelIds.has(dialogue.panelId)) {
      orphanDialogueIds.push(dialogue.id);
      addDiagnostic(collector, {
        severity: "error",
        code: "DIALOGUE_PANEL_NOT_FOUND",
        message: "대사가 참조한 패널을 찾을 수 없어요.",
        path: `stages.dialogue-sfx.dialogue[${dialogueIndex}].panelId`,
        dialogueId: dialogue.id,
        referenceId: dialogue.panelId,
      });
    }
    if (dialogue.characterId) {
      diagnoseMissingCharacterIds(
        [dialogue.characterId],
        `stages.dialogue-sfx.dialogue[${dialogueIndex}].characterId`,
        roster,
        collector,
        { dialogueId: dialogue.id, panelId: dialogue.panelId }
      );
    }
  });

  const orphanSfxIds: string[] = [];
  document.stages["dialogue-sfx"].sfx.forEach((sfx, sfxIndex) => {
    if (!sfx.panelId) {
      orphanSfxIds.push(sfx.id);
      addDiagnostic(collector, {
        severity: "error",
        code: "SFX_PANEL_ID_MISSING",
        message: "효과음을 배치할 패널 ID가 비어 있어요.",
        path: `stages.dialogue-sfx.sfx[${sfxIndex}].panelId`,
        sfxId: sfx.id,
      });
    } else if (!panelIds.has(sfx.panelId)) {
      orphanSfxIds.push(sfx.id);
      addDiagnostic(collector, {
        severity: "error",
        code: "SFX_PANEL_NOT_FOUND",
        message: "효과음이 참조한 패널을 찾을 수 없어요.",
        path: `stages.dialogue-sfx.sfx[${sfxIndex}].panelId`,
        sfxId: sfx.id,
        referenceId: sfx.panelId,
      });
    }
  });
  return { orphanDialogueIds, orphanSfxIds };
}

/**
 * Projects reviewed Writer Room stages into a deterministic canvas/scenario hand-off.
 *
 * Errors make `applyReadiness.canApply` false because applying would lose or mis-attach content.
 * Warnings describe deterministic tie-breaks and editorial compromises that remain safe to apply.
 */
export function projectStudioWriterRoomToCanvasPlan(
  value: unknown,
  options: StudioWriterRoomCanvasProjectionOptions = {}
): StudioWriterRoomCanvasProjectionResult {
  const document = normalizeStudioWriterRoomDocument(value);
  const roster = normalizeCharacters(options);
  const settings = {
    ...projectionSettings(options),
    characterValidation: roster.validation,
  };
  const collector = createDiagnosticCollector();
  const { orphanDialogueIds, orphanSfxIds } = diagnoseSourceReferences({
    document,
    roster,
    collector,
  });
  const scenesById = new Map(document.stages.scenes.items.map((scene) => [scene.id, scene]));
  const dialoguesByPanelId = groupByPanelId(document.stages["dialogue-sfx"].dialogue);
  const sfxByPanelId = groupByPanelId(document.stages["dialogue-sfx"].sfx);
  const sourcePanels = document.stages["panel-plan"].items;
  const projectedSourcePanels = sourcePanels.slice(0, settings.maxProjectedPanels);
  const omittedPanelIds = sourcePanels
    .slice(settings.maxProjectedPanels)
    .map(({ id }) => id);
  const omittedPanelIdSet = new Set(omittedPanelIds);

  if (sourcePanels.length === 0) {
    addDiagnostic(collector, {
      severity: "error",
      code: "NO_PANELS",
      message: "캔버스로 보낼 패널 계획이 없어요.",
      path: "stages.panel-plan.items",
    });
  }
  if (omittedPanelIds.length > 0) {
    addDiagnostic(collector, {
      severity: "error",
      code: "PANEL_PROJECTION_LIMIT_EXCEEDED",
      message: "안전한 한 번 적용 한도를 넘은 패널이 있어 일부를 보류했어요.",
      path: "stages.panel-plan.items",
    });
  }

  const omittedDialogueIds = document.stages["dialogue-sfx"].dialogue
    .filter(({ panelId }) => omittedPanelIdSet.has(panelId))
    .map(({ id }) => id);
  const omittedSfxIds = document.stages["dialogue-sfx"].sfx
    .filter(({ panelId }) => omittedPanelIdSet.has(panelId))
    .map(({ id }) => id);
  let dialoguePerPanelLimited = false;
  let sfxPerPanelLimited = false;
  const panels: StudioWriterRoomCanvasPanelProjection[] = projectedSourcePanels.map(
    (panel, panelIndex) => {
      const scene = scenesById.get(panel.sceneId);
      if (!panel.sceneId) {
        addDiagnostic(collector, {
          severity: "error",
          code: "PANEL_SCENE_ID_MISSING",
          message: "패널에 연결된 장면 ID가 비어 있어요.",
          path: `stages.panel-plan.items[${panelIndex}].sceneId`,
          panelId: panel.id,
        });
      } else if (!scene) {
        addDiagnostic(collector, {
          severity: "error",
          code: "PANEL_SCENE_NOT_FOUND",
          message: "패널이 참조한 장면을 찾을 수 없어요.",
          path: `stages.panel-plan.items[${panelIndex}].sceneId`,
          panelId: panel.id,
          referenceId: panel.sceneId,
        });
      }
      diagnoseMissingCharacterIds(
        panel.characterIds,
        `stages.panel-plan.items[${panelIndex}].characterIds`,
        roster,
        collector,
        { panelId: panel.id, ...(scene ? { sceneId: scene.id } : {}) }
      );

      const allDialogue = dialoguesByPanelId.get(panel.id) ?? [];
      diagnoseDuplicateOrders(
        allDialogue,
        collector,
        "DIALOGUE_ORDER_DUPLICATE",
        `stages.dialogue-sfx.dialogue(panel:${panel.id})`,
        ({ id: dialogueId }) => ({ dialogueId, panelId: panel.id })
      );
      const dialogue = allDialogue.slice(0, settings.maxDialogueLinesPerPanel);
      const omittedDialogue = allDialogue.slice(settings.maxDialogueLinesPerPanel);
      if (omittedDialogue.length > 0) {
        dialoguePerPanelLimited = true;
        omittedDialogueIds.push(...omittedDialogue.map(({ id }) => id));
        addDiagnostic(collector, {
          severity: "error",
          code: "PANEL_DIALOGUE_LIMIT_EXCEEDED",
          message: "한 패널의 안전한 대사 수 한도를 넘어 일부 대사를 보류했어요.",
          path: `stages.dialogue-sfx.dialogue(panel:${panel.id})`,
          panelId: panel.id,
        });
      }
      const dialogueLines = dialogue.map((item) => projectDialogueLine(item, roster));
      dialogueLines.forEach((line) => {
        if (line.text) return;
        addDiagnostic(collector, {
          severity: "warning",
          code: "DIALOGUE_EMPTY",
          message: "빈 대사는 시나리오 말풍선 입력에서 제외했어요.",
          path: `stages.dialogue-sfx.dialogue(id:${line.id}).text`,
          panelId: panel.id,
          dialogueId: line.id,
        });
      });
      const dialogueScript = dialogueLines
        .map(({ scenarioLine }) => scenarioLine)
        .filter(Boolean)
        .join("\n");

      const allSfx = sfxByPanelId.get(panel.id) ?? [];
      diagnoseDuplicateOrders(
        allSfx,
        collector,
        "SFX_ORDER_DUPLICATE",
        `stages.dialogue-sfx.sfx(panel:${panel.id})`,
        ({ id: sfxId }) => ({ sfxId, panelId: panel.id })
      );
      const sfx = allSfx.slice(0, settings.maxSfxLabelsPerPanel);
      const omittedSfx = allSfx.slice(settings.maxSfxLabelsPerPanel);
      if (omittedSfx.length > 0) {
        sfxPerPanelLimited = true;
        omittedSfxIds.push(...omittedSfx.map(({ id }) => id));
        addDiagnostic(collector, {
          severity: "error",
          code: "PANEL_SFX_LIMIT_EXCEEDED",
          message: "한 패널의 안전한 효과음 수 한도를 넘어 일부 효과음을 보류했어요.",
          path: `stages.dialogue-sfx.sfx(panel:${panel.id})`,
          panelId: panel.id,
        });
      }
      const sfxLabels = sfx.map(projectSfx);
      const characterIds = sortedUnique([
        ...(scene?.characterIds ?? []),
        ...panel.characterIds,
        ...dialogue.flatMap(({ characterId }) => (characterId ? [characterId] : [])),
      ]);
      const hasVisualContent = Boolean(
        panel.shot ||
          panel.action ||
          scene?.heading ||
          scene?.summary ||
          scene?.location ||
          scene?.time ||
          dialogueScript ||
          sfxLabels.some(({ text }) => text)
      );
      if (!hasVisualContent) {
        addDiagnostic(collector, {
          severity: "error",
          code: "PANEL_EMPTY",
          message: "장면 설명, 동작, 대사, 효과음이 모두 비어 있는 패널이에요.",
          path: `stages.panel-plan.items[${panelIndex}]`,
          panelId: panel.id,
          ...(scene ? { sceneId: scene.id } : {}),
        });
      }
      const scenario = scenarioInputForPanel({
        panel,
        scene,
        characterIds,
        dialogueScript,
        sfxLabels,
        roster,
      });
      const estimatedLayout = layoutScenarioPanels(
        [],
        settings.canvasWidth,
        0,
        [scenario]
      ).panels[0];
      const estimatedFrameHeight = estimatedLayout?.frame.height ?? 0;
      if (
        estimatedLayout?.bubbles.some(
          (bubble) => bubble.y + bubble.height > estimatedLayout.frame.y + estimatedLayout.frame.height
        )
      ) {
        addDiagnostic(collector, {
          severity: "error",
          code: "DIALOGUE_LAYOUT_OVERFLOW",
          message: "대사 말풍선 높이가 패널 최대 높이를 넘어 패널 분할이 필요해요.",
          path: `stages.dialogue-sfx.dialogue(panel:${panel.id})`,
          panelId: panel.id,
          ...(scene ? { sceneId: scene.id } : {}),
        });
      }
      return {
        id: panel.id,
        order: panel.order,
        sequence: panelIndex,
        sceneId: panel.sceneId,
        scene: scene ? cloneScene(scene) : null,
        sceneSummary: scene?.summary ?? "",
        shot: panel.shot,
        action: panel.action,
        declaredCharacterIds: panel.characterIds.slice(),
        characterIds,
        dialogueLines,
        dialogueScript,
        sfxLabels,
        scenario,
        estimatedFrameHeight,
        empty: !hasVisualContent,
      };
    }
  );

  const pageGrouping = groupPages(panels, settings, collector);
  const blockingDiagnosticCodes = [...collector.blockingCodes];
  const canApply = blockingDiagnosticCodes.length === 0;
  const omitted = Object.freeze({
    panelIds: Object.freeze(sortedUnique(omittedPanelIds)),
    dialogueIds: Object.freeze(sortedUnique(omittedDialogueIds)),
    sfxIds: Object.freeze(sortedUnique(omittedSfxIds)),
  });
  const limitedBy: ("panels" | "dialogue-per-panel" | "sfx-per-panel")[] = [];
  if (omitted.panelIds.length > 0) limitedBy.push("panels");
  if (dialoguePerPanelLimited) limitedBy.push("dialogue-per-panel");
  if (sfxPerPanelLimited) limitedBy.push("sfx-per-panel");
  const handoffReceipt: StudioWriterRoomCanvasHandoffReceipt = limitedBy.length === 0
    ? Object.freeze({
        status: "complete",
        limitedBy: Object.freeze([]) as readonly [],
        continuation: null,
      })
    : Object.freeze({
        status: "limited",
        limitedBy: Object.freeze(limitedBy.slice()),
        continuation: omitted,
      });
  return {
    version: STUDIO_WRITER_ROOM_CANVAS_PROJECTION_VERSION,
    settings,
    panels,
    scenarioScenes: panels.map(({ scenario }) => cloneScenarioInput(scenario)),
    pageGrouping,
    diagnostics: collector.diagnostics,
    diagnosticsTruncated: collector.totalCount > collector.diagnostics.length,
    applyReadiness: {
      status: canApply ? "ready" : "blocked",
      canApply,
      blockingDiagnosticCodes,
      errorCount: collector.errorCount,
      warningCount: collector.warningCount,
    },
    handoffReceipt,
    omitted,
    orphans: {
      dialogueIds: sortedUnique(orphanDialogueIds),
      sfxIds: sortedUnique(orphanSfxIds),
    },
  };
}
