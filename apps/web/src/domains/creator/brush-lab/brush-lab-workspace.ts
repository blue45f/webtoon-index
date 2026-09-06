import { parseBrushLabRecipe } from "./brush-lab-recipe";

import type { BrushLabRecipe } from "./brush-lab-recipe";

export const BRUSH_LAB_WORKSPACE_KIND = "toonspectrum-brush-lab-workspace";
export const BRUSH_LAB_WORKSPACE_VERSION = 1;
/** Changes when the deterministic variant algorithm changes, independently of slot schema. */
export const BRUSH_LAB_GENERATOR_REVISION = 2;
export const BRUSH_LAB_WORKSPACE_MAX_BYTES = 3 * 1024 * 1024;
const BRUSH_MAX_BYTES = 1024 * 1024;

export interface BrushLabWorkspace {
  readonly brush: string;
  readonly reference: string;
  readonly recipe: BrushLabRecipe;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
function brushFile(value: unknown): string {
  if (typeof value !== "string" || value.length > BRUSH_MAX_BYTES || byteLength(value) > BRUSH_MAX_BYTES) {
    throw new Error("작업 파일의 각 브러시는 1MB 이하의 JSON이어야 합니다.");
  }
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("작업 파일의 브러시 JSON이 올바르지 않습니다.");
  // Native brush schema, program registry and carrier checks remain the native importer's job.
  return value;
}

export function readBrushLabWorkspace(text: string): BrushLabWorkspace {
  if (text.length > BRUSH_LAB_WORKSPACE_MAX_BYTES || byteLength(text) > BRUSH_LAB_WORKSPACE_MAX_BYTES) {
    throw new Error("브러시 작업 파일은 3MB 이하만 가져올 수 있습니다.");
  }
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("브러시 작업 파일이 올바르지 않습니다.");
  const source = raw as Record<string, unknown>;
  if (source.kind !== BRUSH_LAB_WORKSPACE_KIND || source.version !== BRUSH_LAB_WORKSPACE_VERSION) {
    throw new Error("지원하지 않는 브러시 작업 파일 버전입니다.");
  }
  if (source.generatorRevision !== BRUSH_LAB_GENERATOR_REVISION) {
    throw new Error("이 작업 파일의 변형 생성기 버전을 지원하지 않습니다. 다른 결과로 자동 대체하지 않습니다.");
  }
  if (!source.recipe || typeof source.recipe !== "object") throw new Error("작업 파일에 조합 레시피가 없습니다.");
  return {
    brush: brushFile(source.brush),
    reference: brushFile(source.reference),
    recipe: parseBrushLabRecipe(JSON.stringify(source.recipe)),
  };
}

export function writeBrushLabWorkspace(workspace: BrushLabWorkspace): string {
  const text = JSON.stringify({
    kind: BRUSH_LAB_WORKSPACE_KIND,
    version: BRUSH_LAB_WORKSPACE_VERSION,
    generatorRevision: BRUSH_LAB_GENERATOR_REVISION,
    brush: workspace.brush,
    reference: workspace.reference,
    recipe: workspace.recipe,
  }, null, 2);
  // Apply exactly the same bounds and schema to our own export as to an imported file.
  readBrushLabWorkspace(text);
  return text;
}
