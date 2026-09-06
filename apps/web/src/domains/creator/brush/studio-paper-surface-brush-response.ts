/**
 * Compact, user-facing brush-family response summary for a document paper.
 * Values come from the same family table and paper physics used by stroke planning.
 */

import {
  STUDIO_PAPER_BRUSH_RESPONSE,
  applyStudioPaperPhysicsToBrushResponse,
} from "./studio-paper-brush-response";
import {
  getStudioPaperSurfaceCatalogEntry,
  getStudioPaperSurfaceCharacteristics,
} from "./studio-paper-surface-catalog";

import type { PaperGrainKind } from "./studio-paper-texture";

export type StudioPaperBrushResponseKind = "dry" | "wet" | "paint" | "digital";

export interface StudioPaperBrushResponseSummary {
  readonly id: StudioPaperBrushResponseKind;
  readonly label: string;
  readonly level: string;
  readonly value: number;
  readonly description: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function effectiveResponse(
  family: "dry-media" | "watercolor" | "brush" | "oil",
  kind: PaperGrainKind,
): number {
  const response = applyStudioPaperPhysicsToBrushResponse(
    STUDIO_PAPER_BRUSH_RESPONSE[family],
    kind,
  );
  return clamp01(response.granulation * (1 - response.staining));
}

function responseLevel(value: number): string {
  if (value <= 0.01) return "영향 없음";
  if (value < 0.16) return "매우 약함";
  if (value < 0.3) return "약함";
  if (value < 0.46) return "보통";
  if (value < 0.6) return "강함";
  return "매우 강함";
}

export function getStudioPaperBrushResponseSummaries(
  kindInput: PaperGrainKind | unknown,
): readonly StudioPaperBrushResponseSummary[] {
  const catalog = getStudioPaperSurfaceCatalogEntry(kindInput);
  const kind = catalog.id;
  const axes = new Map(
    getStudioPaperSurfaceCharacteristics(kind).map((axis) => [axis.id, axis] as const),
  );
  const axisLabel = (id: "tooth" | "absorbency" | "bleed" | "friction") =>
    axes.get(id)?.valueLabel ?? "보통";
  const dry = effectiveResponse("dry-media", kind);
  const wet = effectiveResponse("watercolor", kind);
  const paint = Math.max(effectiveResponse("brush", kind), effectiveResponse("oil", kind));
  const weave = kind === "canvas" || kind === "linen-canvas";
  const fibre = kind === "washi" || kind === "rice-paper" || kind === "mulberry";

  return Object.freeze([
    Object.freeze({
      id: "dry" as const,
      label: "연필·목탄·파스텔",
      level: responseLevel(dry),
      value: dry,
      description: `결 ${axisLabel("tooth")}·가루 고정 ${axisLabel("friction")}. 입자형 팁은 골에 걸리며 압력이 약할수록 종이 무늬가 잘 드러납니다.`,
    }),
    Object.freeze({
      id: "wet" as const,
      label: "수채·먹·젖은 붓",
      level: responseLevel(wet),
      value: wet,
      description: `${fibre ? "섬유 방향을 따라" : "표면의 낮은 골에"} 안료가 모입니다. 흡수 ${axisLabel("absorbency")}·번짐 ${axisLabel("bleed")}이라 새 젖은 획의 과립과 가장자리가 달라집니다.`,
    }),
    Object.freeze({
      id: "paint" as const,
      label: "유화·아크릴·두꺼운 붓",
      level: responseLevel(paint),
      value: paint,
      description: weave
        ? "두꺼운 팁이 씨실·날실 봉우리를 건너뛰어 직조형 붓자국과 물감 걸림이 선명해집니다."
        : "두꺼운 팁은 높은 면에 먼저 닿아 요철이 강할수록 붓자국의 끊김과 표면 걸림이 커집니다.",
    }),
    Object.freeze({
      id: "digital" as const,
      label: "G펜·마커·에어브러시",
      level: "영향 없음",
      value: 0,
      description: "매끈한 디지털 팁은 종이 결 보정을 사용하지 않아 종이를 바꿔도 선명도와 밀도가 유지됩니다.",
    }),
  ]);
}
