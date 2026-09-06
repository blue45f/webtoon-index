/**
 * Shared brush-behavior presentation for tray, options bar, and inspector.
 *
 * Keep wash/bleed brushes on the same mental model as pens: same size · opacity ·
 * color controls, with one short family chip explaining only the material difference.
 * Product labels stay Korean; internal ids may still use English render families.
 */

import {
  resolveStudioBrushRenderFamily,
  type StudioBrushRenderFamily,
} from "../studio-brush";

export type StudioBrushBehaviorKind =
  | "line"
  | "wash"
  | "air"
  | "dry"
  | "paint"
  | "marker"
  | "special";

export interface StudioBrushBehaviorPresentation {
  readonly kind: StudioBrushBehaviorKind;
  /** Short chip for summaries (e.g. 번짐·수채). */
  readonly labelKo: string;
  /** One-line coaching under the chip / in tooltips. */
  readonly hintKo: string;
}

const FAMILY_TO_BEHAVIOR: Readonly<
  Record<StudioBrushRenderFamily, StudioBrushBehaviorKind>
> = {
  pen: "line",
  gpen: "line",
  calligraphy: "line",
  perfect: "line",
  marker: "marker",
  highlighter: "marker",
  neon: "special",
  glow: "special",
  glitter: "special",
  brush: "paint",
  watercolor: "wash",
  oil: "paint",
  pastel: "dry",
  "ink-particle": "special",
  airbrush: "air",
  "dry-media": "dry",
  pencil: "dry",
  screentone: "special",
  stamp: "special",
  pixel: "line",
};

const BEHAVIOR_COPY: Readonly<
  Record<StudioBrushBehaviorKind, Omit<StudioBrushBehaviorPresentation, "kind">>
> = {
  line: {
    labelKo: "선화",
    hintKo: "크기·농도·색으로 선을 조절합니다. 다른 선 브러시와 같은 조작입니다.",
  },
  wash: {
    labelKo: "번짐·수채",
    hintKo: "크기·농도·색은 다른 브러시와 같고, 종이에 번지는 표현만 더해집니다.",
  },
  air: {
    labelKo: "에어·분사",
    hintKo: "크기·농도로 연하게 쌓습니다. 선 브러시와 같은 색·크기 칩을 씁니다.",
  },
  dry: {
    labelKo: "건식 매체",
    hintKo: "연필·목탄 질감. 크기·농도·색 조작은 선화와 동일합니다.",
  },
  paint: {
    labelKo: "페인트",
    hintKo: "면·붓 표현. 크기·농도·색은 하단·속성 패널에서 같이 맞춥니다.",
  },
  marker: {
    labelKo: "마커",
    hintKo: "마커·형광. 크기·농도·색 조작 경로는 다른 그리기 도구와 같습니다.",
  },
  special: {
    labelKo: "특수 브러시",
    hintKo: "입자·톤 등 특수 표현. 기본 크기·농도·색 경로는 공통입니다.",
  },
};

export function resolveStudioBrushBehaviorKind(
  brushId: string | null | undefined,
): StudioBrushBehaviorKind {
  return FAMILY_TO_BEHAVIOR[resolveStudioBrushRenderFamily(brushId ?? "pen")];
}

export function resolveStudioBrushBehaviorPresentation(
  brushId: string | null | undefined,
): StudioBrushBehaviorPresentation {
  const kind = resolveStudioBrushBehaviorKind(brushId);
  return { kind, ...BEHAVIOR_COPY[kind] };
}

/** User-facing product name for wash physics controls (avoid English “Living Ink”). */
export const STUDIO_WASH_INK_PRODUCT_LABEL_KO = "수채 번짐" as const;
