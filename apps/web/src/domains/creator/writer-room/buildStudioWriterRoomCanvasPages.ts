import { CANVAS_W } from "../studio-assets";
import { uid } from "../studio-id";
import { PAGE_NAME_MAX, PAGE_NOTE_MAX } from "../studio-page-meta";
import { layoutScenarioPanels } from "../studio-scenario-layout";
import { createSfxTextConfig, SFX_LIBRARY } from "../studio-sfx-presets";

import type { El } from "../studio-element-model";
import type { PageState } from "../studio-page-state";
import type { StudioWriterRoomDocument } from "../studio-writer-room";
import type { StudioWriterRoomCanvasProjectionResult } from "../studio-writer-room-canvas-projection";

export interface BuildStudioWriterRoomCanvasPagesInput {
  readonly createId?: () => string;
  readonly plan: StudioWriterRoomCanvasProjectionResult;
  readonly writerRoom: StudioWriterRoomDocument;
}

/**
 * Converts a validated Writer Room projection into ordinary editable Studio pages.
 *
 * The application layer owns no React state and mutates no existing page. Keeping this conversion
 * deterministic makes the editor command responsible only for insertion, selection, and feedback.
 */
export function buildStudioWriterRoomCanvasPages({
  createId = uid,
  plan,
  writerRoom,
}: BuildStudioWriterRoomCanvasPagesInput): PageState[] {
  if (!plan.applyReadiness.canApply || plan.pageGrouping.pages.length === 0) {
    throw new Error("WRITER_ROOM_PLAN_NOT_READY");
  }

  const projectedPanelById = new Map(plan.panels.map((panel) => [panel.id, panel]));
  const episodeTitle = writerRoom.stages["episode-outline"].title.trim() || "Writer Room";

  return plan.pageGrouping.pages.map((group, pageIndex) => {
    const layout = layoutScenarioPanels([], CANVAS_W, 1080, group.scenarioScenes);
    if (layout.panels.length !== group.scenarioScenes.length) {
      throw new Error("WRITER_ROOM_LAYOUT_MISMATCH");
    }

    const pageElements: El[] = [];
    layout.panels.forEach((item, panelIndex) => {
      const scenarioInput = group.scenarioScenes[panelIndex];
      const projectedPanel = scenarioInput
        ? projectedPanelById.get(scenarioInput.writerRoomPanelId)
        : undefined;
      if (!scenarioInput || !projectedPanel) {
        throw new Error("WRITER_ROOM_PANEL_CORRELATION_MISSING");
      }

      pageElements.push({
        id: createId(),
        type: "frame",
        x: item.frame.x,
        y: item.frame.y,
        width: item.frame.width,
        height: item.frame.height,
        storyBeat: {
          type: item.beatType,
          summary: item.summary,
          ...(item.continuity ? { continuity: item.continuity } : {}),
        },
        name: `${panelIndex + 1}컷 · ${projectedPanel.shot || projectedPanel.action || "장면"}`.slice(0, 120),
      });
      item.bubbles.forEach((bubble) => {
        pageElements.push({ id: createId(), ...bubble });
      });

      const visibleSfx = projectedPanel.sfxLabels.filter((label) => label.text.trim().length > 0);
      const columnCount = Math.max(1, Math.min(3, visibleSfx.length));
      const rowCount = Math.max(1, Math.ceil(visibleSfx.length / columnCount));
      const cellWidth = Math.max(96, (item.frame.width - 48) / columnCount);
      const rowStride = Math.max(58, Math.min(92, (item.frame.height - 48) / rowCount));

      visibleSfx.forEach((label, sfxIndex) => {
        const preset = label.presetId
          ? SFX_LIBRARY.find((candidate) => candidate.id === label.presetId)
          : undefined;
        const base = preset
          ? createSfxTextConfig(preset, 0, 0)
          : {
              text: label.text,
              x: 0,
              y: 0,
              width: 220,
              fontSize: 64,
              fill: "#ffb24a",
              stroke: "#2a1208",
              strokeWidth: 6,
              rotation: 0,
              font: "Black Han Sans",
              fontStyle: "bold" as const,
              shadowColor: "#160a04",
              shadowBlur: 7,
              shadowOpacity: 0.32,
            };
        const scale = label.style.scale === "small"
          ? 0.72
          : label.style.scale === "large"
            ? 1.28
            : 1;
        const emphasisScale = label.style.emphasis === "strong" ? 1.1 : 1;
        const fontSize = Math.round(
          Math.max(30, Math.min(92, base.fontSize * scale * emphasisScale)),
        );
        const width = Math.round(Math.max(88, Math.min(cellWidth - 12, base.width * scale)));
        const column = sfxIndex % columnCount;
        const row = Math.floor(sfxIndex / columnCount);
        const x = Math.round(
          item.frame.x + 24 + column * cellWidth + (cellWidth - width) / 2,
        );
        const unclampedY = item.frame.y
          + item.frame.height
          - 24
          - (rowCount - row) * rowStride;
        const y = Math.round(
          Math.max(
            item.frame.y + 18,
            Math.min(item.frame.y + item.frame.height - fontSize - 18, unclampedY),
          ),
        );
        pageElements.push({
          id: createId(),
          type: "text",
          ...base,
          text: label.text,
          x,
          y,
          width,
          fontSize,
          name: `SFX · ${label.text}`.slice(0, 120),
          ...(label.style.emphasis === "quiet" ? { opacity: 0.62 } : {}),
          ...(label.style.emphasis === "strong"
            ? {
                fontStyle: "bold" as const,
                strokeWidth: Math.max(6, (base.strokeWidth ?? 0) + 2),
              }
            : {}),
        });
      });
    });

    return {
      id: createId(),
      elements: pageElements,
      bg: "#ffffff",
      bgGrad: null,
      canvasH: Math.max(1080, layout.nextCanvasH, group.estimatedCanvasHeight),
      name: `${episodeTitle} · 콘티 ${pageIndex + 1}`.slice(0, PAGE_NAME_MAX),
      note: "Writer Room 컷 플랜에서 생성한 편집 가능한 콘티 초안".slice(0, PAGE_NOTE_MAX),
    };
  });
}
