import {
  comicPageIRSchema,
  lowerComicPageToScene,
  polylineToPath,
} from "@toonspectrum/studio-project-model";

import type {
  ColorIR,
  ComicPageIR,
  ComicPanelIR,
  SceneIR,
} from "@toonspectrum/studio-project-model";

/**
 * V12 §13 comic-lane production utilities: page presets that materialize valid
 * ComicPageIR layouts, and the preset→lowering→PNG round-trip.
 *
 * Pure module — no React, no engine import. The PNG step is a port
 * (`renderSceneToPng` is injected, not imported): the root app program maps
 * `canvaskit-wasm` to a narrow type shim, so statically importing
 * "@toonspectrum/studio-engine-skia" sources here would break the root
 * typecheck. Callers pass the engine's `renderSceneToPng` (and the CanvasKit
 * instance from `loadCanvasKitNode` / the browser loader) at the boundary.
 */

export type ComicPagePresetId = "vertical-4koma" | "webtoon-scroll-3" | "free-2cut";

export interface ComicPagePreset {
  readonly id: ComicPagePresetId;
  /** Korean-facing label used by preset pickers. */
  readonly label: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly panelCount: number;
  /** Builds a schema-valid page; `pageId` defaults to the preset id. */
  createPage(pageId?: string): ComicPageIR;
}

function rectPath(x: number, y: number, width: number, height: number) {
  return polylineToPath(
    [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ],
    true,
  );
}

interface PanelSpec {
  id: string;
  points: ReadonlyArray<readonly [number, number]>;
}

function buildPage(
  pageId: string,
  widthPx: number,
  heightPx: number,
  panels: PanelSpec[],
): ComicPageIR {
  return comicPageIRSchema.parse({
    id: pageId,
    widthPx,
    heightPx,
    panels: panels.map(
      (panel, index): ComicPanelIR => ({
        id: panel.id,
        shape: polylineToPath(panel.points, true),
        folderId: `folder:${panel.id}`,
        masksContent: true,
        readingOrder: index,
      }),
    ),
    balloons: [],
    tones: [],
    effectLines: [],
  });
}

function rectPanel(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): PanelSpec {
  return {
    id,
    points: [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ],
  };
}

/**
 * 세로 4컷: classic 4-koma strip — 640×1800, 48px page margin, 24px gutters,
 * four equal panels stacked top-to-bottom in reading order.
 */
function createVertical4KomaPage(pageId: string): ComicPageIR {
  const width = 640;
  const height = 1800;
  const margin = 48;
  const gutter = 24;
  const panelWidth = width - margin * 2;
  const panelHeight = (height - margin * 2 - gutter * 3) / 4;
  const panels = [0, 1, 2, 3].map((index) =>
    rectPanel(
      `koma-${index + 1}`,
      margin,
      margin + index * (panelHeight + gutter),
      panelWidth,
      panelHeight,
    ),
  );
  return buildPage(pageId, width, height, panels);
}

/**
 * 웹툰 세로 스크롤 3컷: 828×1920 (the vertical-scroll authoring viewport),
 * 54px side margins and tall 90px gutters so cuts breathe while scrolling.
 */
function createWebtoonScroll3Page(pageId: string): ComicPageIR {
  const width = 828;
  const height = 1920;
  const marginX = 54;
  const marginY = 60;
  const gutter = 90;
  const panelWidth = width - marginX * 2;
  const panelHeight = (height - marginY * 2 - gutter * 2) / 3;
  const panels = [0, 1, 2].map((index) =>
    rectPanel(
      `scroll-${index + 1}`,
      marginX,
      marginY + index * (panelHeight + gutter),
      panelWidth,
      panelHeight,
    ),
  );
  return buildPage(pageId, width, height, panels);
}

/**
 * 자유 2컷: 1000×760 landscape page split by a slanted gutter — two
 * quadrilateral panels proving panel shapes are not grid-bound.
 */
function createFree2CutPage(pageId: string): ComicPageIR {
  const panels: PanelSpec[] = [
    {
      id: "free-1",
      points: [
        [60, 60],
        [940, 60],
        [940, 300],
        [60, 520],
      ],
    },
    {
      id: "free-2",
      points: [
        [60, 560],
        [940, 340],
        [940, 700],
        [60, 700],
      ],
    },
  ];
  return buildPage(pageId, 1000, 760, panels);
}

export const COMIC_PAGE_PRESETS: Record<ComicPagePresetId, ComicPagePreset> = {
  "vertical-4koma": {
    id: "vertical-4koma",
    label: "세로 4컷",
    widthPx: 640,
    heightPx: 1800,
    panelCount: 4,
    createPage: (pageId = "vertical-4koma") => createVertical4KomaPage(pageId),
  },
  "webtoon-scroll-3": {
    id: "webtoon-scroll-3",
    label: "웹툰 스크롤 3컷",
    widthPx: 828,
    heightPx: 1920,
    panelCount: 3,
    createPage: (pageId = "webtoon-scroll-3") => createWebtoonScroll3Page(pageId),
  },
  "free-2cut": {
    id: "free-2cut",
    label: "자유 2컷",
    widthPx: 1000,
    heightPx: 760,
    panelCount: 2,
    createPage: (pageId = "free-2cut") => createFree2CutPage(pageId),
  },
};

export const COMIC_PAGE_PRESET_IDS = Object.keys(
  COMIC_PAGE_PRESETS,
) as ComicPagePresetId[];

/** Scene→PNG port satisfied by `renderSceneToPng` of the skia engine. */
export interface ComicSceneToPngRenderer<Ck> {
  (ck: Ck, scene: SceneIR, options?: { fontData?: Uint8Array }): Uint8Array;
}

export interface RenderComicPagePngOptions<Ck> {
  /** Engine port — pass `renderSceneToPng` from "@toonspectrum/studio-engine-skia". */
  renderSceneToPng: ComicSceneToPngRenderer<Ck>;
  /** Page background; defaults to the lowering's opaque white. */
  background?: ColorIR;
  /** Font bytes forwarded to the engine when the scene contains text nodes. */
  fontData?: Uint8Array;
}

export interface RenderComicPagePngResult {
  png: Uint8Array;
  /** The lowered scene the PNG was rendered from (digest/inspection hook). */
  scene: SceneIR;
  /** Lowering warnings, propagated verbatim — never swallowed. */
  warnings: string[];
}

/**
 * Preset→render round-trip: lowers the page through lowerComicPageToScene and
 * rasterizes the resulting SceneIR with the injected engine renderer. Lowering
 * warnings propagate to the caller; render failures throw (no quiet loss).
 */
export function renderComicPagePng<Ck>(
  ck: Ck,
  page: ComicPageIR,
  options: RenderComicPagePngOptions<Ck>,
): RenderComicPagePngResult {
  const { scene, warnings } = lowerComicPageToScene(page, {
    background: options.background,
  });
  const png = options.renderSceneToPng(
    ck,
    scene,
    options.fontData === undefined ? undefined : { fontData: options.fontData },
  );
  return { png, scene, warnings: [...warnings] };
}

export { rectPath as comicPresetRectPath };
