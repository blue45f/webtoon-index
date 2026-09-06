/**
 * Drawing HUD / status label builders — Concepts / Krita / CSP status bar cues.
 * Pure strings for StudioStatusBar; no React.
 */

export type StudioDrawHudTool =
  | { mode: "pen"; brushName: string; widthPx: number; opacity01: number }
  | { mode: "pixel" }
  | { mode: "eraser"; widthPx: number; brushName?: string; opacity01?: number }
  | { mode: "shape"; shapeLabel: string }
  | { mode: "select"; selectionLabel: string | null }
  | { mode: "other"; label: string };

export function studioDrawHudToolLabel(tool: StudioDrawHudTool): string {
  switch (tool.mode) {
    case "pen":
      return `${tool.brushName} · ${Math.round(tool.widthPx)}px · ${Math.round(tool.opacity01 * 100)}%`;
    case "pixel":
      return "픽셀 펜 · 1px · HARD · RAW";
    case "eraser":
      if (tool.brushName && tool.opacity01 !== undefined) {
        return `${tool.brushName} · ${Math.round(tool.widthPx)}px · ${Math.round(tool.opacity01 * 100)}%`;
      }
      return `지우개 ${Math.round(tool.widthPx)}px`;
    case "shape":
      return `도형 · ${tool.shapeLabel}`;
    case "select":
      return tool.selectionLabel ? `선택 · ${tool.selectionLabel}` : "선택";
    case "other":
      return tool.label;
  }
}

export type StudioSymmetryHud =
  | "none"
  | "vertical"
  | "horizontal"
  | "radial"
  | "kaleidoscope"
  | "silk";

export function studioSymmetryHudLabel(type: StudioSymmetryHud): string | null {
  switch (type) {
    case "none":
      return null;
    case "vertical":
      return "대칭 세로";
    case "horizontal":
      return "대칭 가로";
    case "radial":
      return "대칭 방사";
    case "kaleidoscope":
      return "대칭 만화경";
    case "silk":
      return "대칭 실크";
  }
}

export function studioStabilizerHudLabel(
  strength: number,
  mode: "standard" | "adaptive" | "precision" = "adaptive"
): string {
  const modeKo =
    mode === "standard" ? "표준" : mode === "precision" ? "정밀" : "적응";
  // 내부 0..10 값은 0.1 단위로 조절된다. 정수 반올림은 기본 3.4를 시각적으로 3이라고
  // 잘못 읽게 만들어, 실제 입력 지연과 HUD 설명이 서로 다른 설정처럼 보였다.
  const displayedStrength = Math.round(strength * 10) / 10;
  return `보정 ${displayedStrength} · ${modeKo}`;
}

/** Clamp displayed pressure 0–1 for HUD meter width. */
export function studioPressureHudRatio(pressure: number | null | undefined): number | null {
  if (pressure === null || pressure === undefined) return null;
  if (!Number.isFinite(pressure)) return null;
  return Math.min(1, Math.max(0, pressure));
}

export function studioShapeKindLabel(kind: string): string {
  const map: Record<string, string> = {
    line: "선",
    rect: "사각형",
    ellipse: "타원",
    star: "별",
    arrow: "화살표",
    triangle: "삼각형",
    polygon: "다각형",
  };
  return map[kind] ?? kind;
}

/** Canonical shape kinds for pickers — pure data (keeps heavy glyphs out of StudioPage static graph). */
export const STUDIO_DRAW_SHAPE_PICKER_KINDS = [
  { kind: "line", label: "선" },
  { kind: "rect", label: "사각형" },
  { kind: "ellipse", label: "타원" },
  { kind: "star", label: "별" },
  { kind: "arrow", label: "화살표" },
  { kind: "triangle", label: "삼각형" },
  { kind: "polygon", label: "다각형" },
] as const;

export function studioPressureCurveHudLabel(
  curve: "soft" | "linear" | "firm" | number
): string {
  if (curve === "soft" || curve === 0.6 || curve === 0.5) return "필압 민감";
  if (curve === "firm" || curve === 1.6 || curve === 1.5) return "필압 단단";
  if (typeof curve === "number") {
    if (curve < 0.85) return "필압 민감";
    if (curve > 1.25) return "필압 단단";
  }
  return "필압 기본";
}

/** Short status chip when shape fill is enabled. */
export function studioShapeFillHudLabel(filled: boolean, kind: string): string | null {
  if (!filled) return null;
  if (kind === "line" || kind === "arrow") return null;
  return "채우기";
}
