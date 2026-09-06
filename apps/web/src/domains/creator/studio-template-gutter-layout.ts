import { CANVAS_W, type FrameSpec, type TemplateSpec } from "./studio-assets";

export const STUDIO_TEMPLATE_GUTTER_MIN = 8;
export const STUDIO_TEMPLATE_GUTTER_MAX = 48;
export const STUDIO_TEMPLATE_GUTTER_STEP = 2;

export type StudioTemplateGutterUnavailableReason =
  | "no-template"
  | "no-panels"
  | "unsupported-topology";

export type StudioTemplateGutterTopology =
  | { readonly kind: "stack"; readonly count: number }
  | { readonly kind: "grid"; readonly columns: number; readonly rows: number }
  | { readonly kind: "columns"; readonly count: number }
  | { readonly kind: "inset" };

export type StudioTemplateGutterCapability =
  | {
      readonly supported: true;
      readonly topology: StudioTemplateGutterTopology;
    }
  | {
      readonly supported: false;
      readonly reason: StudioTemplateGutterUnavailableReason;
    };

/**
 * Only templates whose rectangular topology can be regenerated without guessing belong here.
 * Unknown or irregular templates deliberately fail closed: changing one slider must never erase
 * panels or flatten an authored composition into a generic stack/grid.
 */
const SUPPORTED_TOPOLOGIES: Readonly<Record<string, StudioTemplateGutterTopology>> = {
  webtoon2: { kind: "stack", count: 2 },
  webtoon3: { kind: "stack", count: 3 },
  webtoon4: { kind: "stack", count: 4 },
  webtoon5: { kind: "stack", count: 5 },
  webtoon6: { kind: "stack", count: 6 },
  webtoon7: { kind: "stack", count: 7 },
  webtoon8: { kind: "stack", count: 8 },
  webtoon10: { kind: "stack", count: 10 },
  strip4: { kind: "stack", count: 4 },
  single: { kind: "stack", count: 1 },
  grid4: { kind: "grid", columns: 2, rows: 2 },
  grid6: { kind: "grid", columns: 2, rows: 3 },
  grid8: { kind: "grid", columns: 2, rows: 4 },
  grid9: { kind: "grid", columns: 3, rows: 3 },
  grid12: { kind: "grid", columns: 3, rows: 4 },
  storyboard3: { kind: "columns", count: 3 },
  storyboard6: { kind: "grid", columns: 3, rows: 2 },
  "webtoon-character-sheet": { kind: "grid", columns: 2, rows: 2 },
  "cover-square": { kind: "inset" },
  "cover-instagram": { kind: "inset" },
  "cover-poster": { kind: "inset" },
  "cover-story": { kind: "inset" },
};

/** Authored asymmetric geometry whose whitespace cannot be changed without redesigning panels. */
const EXPLICITLY_UNSUPPORTED_TOPOLOGIES = new Set([
  "dynamic-hero-top",
  "dynamic-hero-left",
  "dynamic-hero-right",
  "dynamic-manga-five",
  "dynamic-dialogue",
  "dynamic-action-zoom",
  "dynamic-cinematic-banner",
]);

const GEOMETRY_EPSILON = 0.001;

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= GEOMETRY_EPSILON;
}

function uniqueCoordinates(values: readonly number[]): number[] {
  return values.reduce<number[]>((coordinates, value) => {
    if (!coordinates.some((coordinate) => approximatelyEqual(coordinate, value))) {
      coordinates.push(value);
    }
    return coordinates;
  }, []);
}

function frameIsFiniteAndInBounds(frame: FrameSpec, canvasH: number): boolean {
  const values = [frame.x, frame.y, frame.width, frame.height, canvasH];
  return (
    values.every(Number.isFinite) &&
    canvasH > 0 &&
    frame.x >= 0 &&
    frame.y >= 0 &&
    frame.width > 0 &&
    frame.height > 0 &&
    frame.x + frame.width <= CANVAS_W + GEOMETRY_EPSILON &&
    frame.y + frame.height <= canvasH + GEOMETRY_EPSILON
  );
}

function frameCountForTopology(topology: StudioTemplateGutterTopology): number {
  switch (topology.kind) {
    case "stack":
    case "columns":
      return topology.count;
    case "grid":
      return topology.columns * topology.rows;
    case "inset":
      return 1;
  }
}

function framesMatchTopology(
  frames: readonly FrameSpec[],
  topology: StudioTemplateGutterTopology,
  canvasH: number,
): boolean {
  if (frames.length !== frameCountForTopology(topology)) return false;

  const xCoordinates = uniqueCoordinates(frames.map((frame) => frame.x));
  const yCoordinates = uniqueCoordinates(frames.map((frame) => frame.y));
  const widths = uniqueCoordinates(frames.map((frame) => frame.width));
  const heights = uniqueCoordinates(frames.map((frame) => frame.height));

  switch (topology.kind) {
    case "stack":
      return (
        xCoordinates.length === 1 &&
        yCoordinates.length === topology.count &&
        widths.length === 1 &&
        heights.length === 1
      );
    case "columns":
      return (
        xCoordinates.length === topology.count &&
        yCoordinates.length === 1 &&
        widths.length === 1 &&
        heights.length === 1
      );
    case "grid": {
      if (
        xCoordinates.length !== topology.columns ||
        yCoordinates.length !== topology.rows ||
        widths.length !== 1 ||
        heights.length !== 1
      ) {
        return false;
      }
      const occupiedCells = new Set(
        frames.map((frame) => {
          const column = xCoordinates.findIndex((x) => approximatelyEqual(x, frame.x));
          const row = yCoordinates.findIndex((y) => approximatelyEqual(y, frame.y));
          return `${column}:${row}`;
        }),
      );
      return occupiedCells.size === topology.columns * topology.rows;
    }
    case "inset": {
      const frame = frames[0]!;
      return (
        approximatelyEqual(frame.x, CANVAS_W - frame.x - frame.width) &&
        approximatelyEqual(frame.y, canvasH - frame.y - frame.height)
      );
    }
  }
}

export function resolveStudioTemplateGutterCapability(
  template: TemplateSpec | null,
): StudioTemplateGutterCapability {
  if (!template) return { supported: false, reason: "no-template" };
  if (template.frames.length === 0) return { supported: false, reason: "no-panels" };
  if (EXPLICITLY_UNSUPPORTED_TOPOLOGIES.has(template.id)) {
    return { supported: false, reason: "unsupported-topology" };
  }

  const topology = SUPPORTED_TOPOLOGIES[template.id];
  if (
    !topology ||
    !Number.isFinite(template.canvasH) ||
    template.canvasH <= 0 ||
    !template.frames.every((frame) => frameIsFiniteAndInBounds(frame, template.canvasH)) ||
    !framesMatchTopology(template.frames, topology, template.canvasH)
  ) {
    return { supported: false, reason: "unsupported-topology" };
  }

  return { supported: true, topology };
}

function regenerateStack(
  count: number,
  canvasH: number,
  gutter: number,
): FrameSpec[] {
  const height = (canvasH - gutter * (count + 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: gutter,
    y: gutter + index * (height + gutter),
    width: CANVAS_W - gutter * 2,
    height,
  }));
}

function regenerateGrid(
  columns: number,
  rows: number,
  canvasH: number,
  gutter: number,
): FrameSpec[] {
  const width = (CANVAS_W - gutter * (columns + 1)) / columns;
  const height = (canvasH - gutter * (rows + 1)) / rows;
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: gutter + column * (width + gutter),
      y: gutter + row * (height + gutter),
      width,
      height,
    };
  });
}

function regenerateColumns(
  count: number,
  canvasH: number,
  gutter: number,
): FrameSpec[] {
  const width = (CANVAS_W - gutter * (count + 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: gutter + index * (width + gutter),
    y: gutter,
    width,
    height: canvasH - gutter * 2,
  }));
}

export function regenerateStudioTemplateFrames(
  template: TemplateSpec,
  gutter: number,
): FrameSpec[] | null {
  if (
    !Number.isFinite(gutter) ||
    gutter < STUDIO_TEMPLATE_GUTTER_MIN ||
    gutter > STUDIO_TEMPLATE_GUTTER_MAX
  ) {
    return null;
  }

  const capability = resolveStudioTemplateGutterCapability(template);
  if (!capability.supported) return null;

  const { topology } = capability;
  let frames: FrameSpec[];
  switch (topology.kind) {
    case "stack":
      frames = regenerateStack(topology.count, template.canvasH, gutter);
      break;
    case "grid":
      frames = regenerateGrid(
        topology.columns,
        topology.rows,
        template.canvasH,
        gutter,
      );
      break;
    case "columns":
      frames = regenerateColumns(topology.count, template.canvasH, gutter);
      break;
    case "inset":
      frames = [{
        x: gutter,
        y: gutter,
        width: CANVAS_W - gutter * 2,
        height: template.canvasH - gutter * 2,
      }];
      break;
  }

  return frames.length === template.frames.length &&
    frames.every((frame) => frameIsFiniteAndInBounds(frame, template.canvasH))
    ? frames
    : null;
}
